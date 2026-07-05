import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Local agent state — persisted across restarts. Holds the token issued at pairing, so
 * the file is written private (0600). Defaults to the working directory (works the same
 * from source or a packaged binary); override the location with AGENT_STATE_PATH.
 */
const STATE_PATH = (process.env.AGENT_STATE_PATH ?? '').trim() !== ''
    ? resolve(process.env.AGENT_STATE_PATH)
    : resolve(process.cwd(), 'agent-state.json');

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
