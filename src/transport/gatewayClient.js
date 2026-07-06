import { log } from '../util/log.js';

/**
 * Outbound WebSocket to the sim agent-gateway — the poke channel. The agent authenticates
 * the socket with its existing bearer token (same one used for HTTP); the gateway verifies
 * it against sim and then forwards "pokes". A poke means "pull your tasks now" — the client
 * wakes the poll loop so work is picked up in ~1s instead of waiting out the poll interval.
 *
 * The socket is a pure latency dial and never a correctness dependency: if it can't connect
 * (or native WebSocket isn't available), the agent just keeps polling.
 *
 * Uses the native global WebSocket (Node >= 22 / the release binary). No runtime dependency.
 */
const FRAME = Object.freeze({ HELLO: 'hello', READY: 'ready', POKE: 'poke', BYE: 'bye' });

/**
 * @param {{
 *   url: string,
 *   token: string,
 *   machineId: string,
 *   version: string,
 *   onPoke: () => void,
 * }} params
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createGatewayClient({ url, token, machineId, version, onPoke }) {
    if (!url) {
        log.info('gateway URL not set — pokes disabled, polling only');
        return { start() {}, stop() {} };
    }

    if (typeof WebSocket === 'undefined') {
        log.warn('native WebSocket unavailable (needs Node >= 22) — pokes disabled, polling only');
        return { start() {}, stop() {} };
    }

    let ws = null;
    let stopped = false;
    let attempts = 0;
    /** @type {NodeJS.Timeout | null} */
    let reconnectTimer = null;

    // Exponential backoff capped at 30s, with jitter in [half, full] to avoid a reconnect herd.
    const backoffMs = () => {
        const cap = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
        return cap / 2 + Math.random() * (cap / 2);
    };

    function scheduleReconnect() {
        if (stopped) {
            return;
        }

        attempts += 1;
        reconnectTimer = setTimeout(connect, backoffMs());
    }

    function connect() {
        if (stopped) {
            return;
        }

        try {
            ws = new WebSocket(url);
        } catch (err) {
            log.warn(`gateway connect failed: ${err instanceof Error ? err.message : String(err)}`);
            scheduleReconnect();
            return;
        }

        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ type: FRAME.HELLO, token, machine_id: machineId, agent_version: version }));
        });

        ws.addEventListener('message', (event) => {
            let frame;

            try {
                frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
            } catch {
                return;
            }

            if (frame?.type === FRAME.READY) {
                attempts = 0;
                log.info('gateway connected — pokes live');
            } else if (frame?.type === FRAME.POKE) {
                onPoke();
            } else if (frame?.type === FRAME.BYE) {
                log.warn(`gateway closed the socket: ${frame.reason ?? 'unknown'}`);

                // Another socket took this machine's seat. Stop poking (polling + the
                // server-side nonce guard still sort out who does the work); don't fight it.
                if (frame.reason === 'superseded') {
                    stop();
                }
            }
        });

        ws.addEventListener('close', () => {
            if (!stopped) {
                scheduleReconnect();
            }
        });

        ws.addEventListener('error', () => {
            // A 'close' follows — reconnect is scheduled there.
        });
    }

    function stop() {
        stopped = true;

        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        try {
            ws?.close();
        } catch {
            // already closing
        }
    }

    return {
        start() {
            connect();
        },
        stop,
    };
}
