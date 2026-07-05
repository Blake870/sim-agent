import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { saveState } from './state.js';
import { createServerClient } from './transport/serverClient.js';
import { VERSION } from './version.js';
import { log } from './util/log.js';

/**
 * Ensure the agent holds a token, pairing with the server if it doesn't. On success the
 * token is persisted so this only happens once. Returns the token.
 *
 * @param {ReturnType<import('./config.js').loadConfig>} config
 * @param {Record<string, any>} state  mutable; token/agentId written on success
 * @param {string} machineId
 * @returns {Promise<string>}
 */
export async function ensurePaired(config, state, machineId) {
    if (state.token) {
        return state.token;
    }

    const code = await resolvePairingCode(config);

    if (!code) {
        log.error('Not paired. Set AGENT_PAIRING_CODE (from the sim panel) or run interactively to enter one.');
        process.exit(1);
    }

    log.info('pairing with server...');

    const client = createServerClient({ serverUrl: config.serverUrl, token: null });
    let result;

    try {
        result = await client.pair(code, machineId, VERSION);
    } catch (error) {
        log.error(`pairing failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    state.token = result.token;
    state.agentId = result.agent_id;
    state.nonce = result.nonce ?? null; // rolling anti-clone nonce; advanced on each heartbeat
    saveState(state);

    log.info(`paired successfully as agent ${state.agentId}`);

    return state.token;
}

async function resolvePairingCode(config) {
    if (config.pairingCode) {
        return config.pairingCode;
    }

    // Fall back to an interactive prompt only when attached to a terminal.
    if (!stdin.isTTY) {
        return null;
    }

    const rl = createInterface({ input: stdin, output: stdout });

    try {
        const answer = await rl.question('Enter pairing code: ');
        return answer.trim();
    } finally {
        rl.close();
    }
}
