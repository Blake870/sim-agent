/**
 * Runtime configuration from the environment. The token and machine id are NOT here —
 * they live in the persisted state file (see state.js), since the token is issued at
 * pairing rather than configured by hand.
 *
 * @returns {{
 *   serverUrl: string,
 *   pairingCode: string,
 *   pollIntervalMs: number,
 *   demo: boolean,
 * }}
 */
export function loadConfig() {
    const pollIntervalMs = Number.parseInt(process.env.AGENT_POLL_INTERVAL_MS ?? '20000', 10);

    return {
        serverUrl: (process.env.AGENT_SERVER_URL ?? '').trim().replace(/\/+$/, ''),
        pairingCode: (process.env.AGENT_PAIRING_CODE ?? '').trim(),
        pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 20_000,
        demo: process.env.AGENT_DEMO === '1',
    };
}
