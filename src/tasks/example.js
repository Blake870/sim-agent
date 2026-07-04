import { log } from '../util/log.js';

/**
 * The one and only task type for now. A no-op placeholder that proves the
 * pull -> dispatch -> report loop works end to end. Real Steam primitives
 * (checkInventory, sendTrade, confirmMobile) will be added as sibling task types later.
 *
 * @param {{ id: string|number, type: 'example', payload?: { echo?: string } }} task
 * @returns {Promise<{ ok: true, result: object }>}
 */
export async function runExample(task) {
    const echo = task.payload?.echo ?? 'hello from sim-agent';

    log.info(`example: ${echo}`);

    return {
        ok: true,
        result: {
            echo,
            handledAt: new Date().toISOString(),
        },
    };
}
