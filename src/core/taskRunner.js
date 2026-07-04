import { runExample } from '../tasks/example.js';

/**
 * Maps a task type to its handler. The runner holds NO business logic — it only
 * routes. Add a new entry here for each Steam primitive as it lands.
 */
const HANDLERS = {
    example: runExample,
};

/**
 * Execute a single task and return an outcome safe to send back to the server.
 * Never throws: a handler failure becomes `{ ok: false, error }` so one bad task
 * cannot stop the poll loop.
 *
 * @param {{ id: string|number, type: string, payload?: unknown }} task
 * @returns {Promise<{ ok: boolean, result?: unknown, error?: string }>}
 */
export async function runTask(task) {
    const handler = HANDLERS[task.type];

    if (!handler) {
        return { ok: false, error: `unknown task type: ${task.type}` };
    }

    try {
        return await handler(task);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
