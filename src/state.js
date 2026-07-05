import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
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
    // Write to a temp file, flush to disk, then atomically rename over the real one, so a
    // crash mid-write can't truncate agent-state.json and lose the token/nonce.
    const tmp = `${STATE_PATH}.tmp`;
    const data = JSON.stringify(state, null, 2) + '\n';

    const fd = openSync(tmp, 'w', 0o600);
    try {
        writeSync(fd, data);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }

    renameSync(tmp, STATE_PATH);

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
