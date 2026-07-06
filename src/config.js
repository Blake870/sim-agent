/**
 * Server URL baked in at build time (from the SIM_AGENT_SERVER_URL build variable), so
 * release binaries just work without the user setting anything. Empty when run from
 * source — then AGENT_SERVER_URL is required.
 */
const BUILTIN_SERVER_URL = typeof __SIM_AGENT_SERVER_URL__ !== 'undefined' ? __SIM_AGENT_SERVER_URL__ : '';

/** Gateway (poke channel) WS URL, optionally baked in at build time like the server URL. */
const BUILTIN_GATEWAY_URL = typeof __SIM_AGENT_GATEWAY_URL__ !== 'undefined' ? __SIM_AGENT_GATEWAY_URL__ : '';

/** Derive the gateway WS URL from the server URL (http->ws, https->wss) + the ws path. */
function deriveGatewayUrl(serverUrl) {
    if (!serverUrl) {
        return '';
    }

    return serverUrl.replace(/^http/, 'ws') + '/agent-ws';
}

/**
 * Runtime configuration from the environment. The token and machine id are NOT here —
 * they live in the persisted state file (see state.js), since the token is issued at
 * pairing rather than configured by hand.
 *
 * @returns {{
 *   serverUrl: string,
 *   gatewayUrl: string,
 *   pairingCode: string,
 *   pollIntervalMs: number,
 *   demo: boolean,
 *   autoUpdate: boolean,
 *   autoUpdateFromEnv: boolean,
 *   pairOnly: boolean,
 * }}
 */
export function loadConfig() {
    const pollIntervalMs = Number.parseInt(process.env.AGENT_POLL_INTERVAL_MS ?? '20000', 10);

    // Env wins (dev/staging override), else the build-time default.
    const serverUrl = ((process.env.AGENT_SERVER_URL ?? '').trim() || BUILTIN_SERVER_URL).replace(/\/+$/, '');

    // Explicit override, else baked-in, else derived from the server URL.
    const gatewayUrl =
        ((process.env.AGENT_GATEWAY_URL ?? '').trim() || BUILTIN_GATEWAY_URL || deriveGatewayUrl(serverUrl)).replace(
            /\/+$/,
            '',
        );

    const autoUpdateEnv = process.env.AGENT_AUTO_UPDATE;

    return {
        serverUrl,
        gatewayUrl,
        pairingCode: (process.env.AGENT_PAIRING_CODE ?? '').trim(),
        pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 20_000,
        demo: process.env.AGENT_DEMO === '1',
        // On by default — verified updates keep every machine patched. Opt out with
        // AGENT_AUTO_UPDATE=0 (or a stored 'off', which index.js applies when the env is unset).
        autoUpdate: autoUpdateEnv !== '0',
        autoUpdateFromEnv: autoUpdateEnv === '0' || autoUpdateEnv === '1',
        // Pair, persist the token, and exit — used by the installer before starting the service.
        pairOnly: process.env.AGENT_PAIR_ONLY === '1',
    };
}
