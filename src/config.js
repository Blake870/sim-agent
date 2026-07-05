/**
 * Server URL baked in at build time (from the SIM_AGENT_SERVER_URL build variable), so
 * release binaries just work without the user setting anything. Empty when run from
 * source — then AGENT_SERVER_URL is required.
 */
const BUILTIN_SERVER_URL = typeof __SIM_AGENT_SERVER_URL__ !== 'undefined' ? __SIM_AGENT_SERVER_URL__ : '';

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
 *   autoUpdate: boolean,
 * }}
 */
export function loadConfig() {
    const pollIntervalMs = Number.parseInt(process.env.AGENT_POLL_INTERVAL_MS ?? '20000', 10);

    // Env wins (dev/staging override), else the build-time default.
    const serverUrl = ((process.env.AGENT_SERVER_URL ?? '').trim() || BUILTIN_SERVER_URL).replace(/\/+$/, '');

    return {
        serverUrl,
        pairingCode: (process.env.AGENT_PAIRING_CODE ?? '').trim(),
        pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 20_000,
        demo: process.env.AGENT_DEMO === '1',
        autoUpdate: process.env.AGENT_AUTO_UPDATE === '1',
    };
}
