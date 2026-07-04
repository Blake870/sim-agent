import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local agent state — persisted across restarts. Holds the token issued at pairing, so
 * the file is written private (0600). Override the location with AGENT_STATE_PATH.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = (process.env.AGENT_STATE_PATH ?? '').trim() !== ''
    ? resolve(process.env.AGENT_STATE_PATH)
    : resolve(srcDir, '..', 'agent-state.json');

export function loadState() {
    if (!existsSync(STATE_PATH)) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

export function saveState(state) {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });

    try {
        chmodSync(STATE_PATH, 0o600);
    } catch {
        // Best effort — permission bits are a no-op on some platforms (e.g. Windows).
    }
}

/** A stable per-machine id, generated once and persisted. */
export function ensureMachineId(state) {
    if (!state.machineId) {
        state.machineId = randomUUID();
        saveState(state);
    }

    return state.machineId;
}
