import { log } from '../util/log.js';
import { runTask } from './taskRunner.js';
import { VERSION } from '../version.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Heartbeat, pull work, dispatch it, report the result, sleep, repeat. This is the whole
 * agent: a client that polls. It never accepts inbound connections.
 *
 * In demo mode there is no server, so it skips the heartbeat and invents a synthetic
 * `example` task each cycle to exercise the loop end to end.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {ReturnType<import('../transport/serverClient.js').createServerClient>|null} client
 */
export async function startPollLoop(config, client) {
    let running = true;

    const stop = () => {
        running = false;
        log.info('shutting down after current cycle');
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    while (running) {
        try {
            if (config.demo) {
                await runCycleTasks([demoTask()], config, client);
            } else {
                await client.heartbeat(VERSION);
                await runCycleTasks(await client.getTasks(), config, client);
            }
        } catch (err) {
            log.error(`poll cycle failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        await sleep(config.pollIntervalMs);
    }
}

async function runCycleTasks(tasks, config, client) {
    for (const task of tasks) {
        log.info(`task ${task.id} (${task.type}) received`);
        const outcome = await runTask(task);

        if (config.demo) {
            log.info(`task ${task.id} outcome: ${JSON.stringify(outcome)}`);
        } else {
            await client.postResult(task.id, outcome);
            log.info(`task ${task.id} reported (ok=${outcome.ok})`);
        }
    }
}

let demoCounter = 0;

function demoTask() {
    demoCounter += 1;
    return { id: `demo-${demoCounter}`, type: 'example', payload: { echo: `demo tick ${demoCounter}` } };
}
