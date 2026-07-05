import { log } from '../util/log.js';
import { runTask } from './taskRunner.js';
import { isNewer, performUpdate } from '../update/updater.js';
import { VERSION } from '../version.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Heartbeat, check the server's version directive, then (if allowed) pull and run work.
 * When the server requires an update, the agent stays alive and keeps heartbeating but
 * does no task work — the enforcement is authoritative server-side; this is the client
 * half that halts cleanly and tells the user.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {ReturnType<import('../transport/serverClient.js').createServerClient>|null} client
 */
export async function startPollLoop(config, client) {
    let running = true;
    let blocked = false;

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
                const heartbeat = await client.heartbeat(VERSION);
                const update = heartbeat?.update ?? {};
                const required = update.required === true;
                const newerAvailable = update.latest_version && isNewer(update.latest_version, VERSION);

                // Self-update when enabled and there's something to update to.
                if (config.autoUpdate && update.download_url && (required || newerAvailable)) {
                    if (await performUpdate(update, config)) {
                        stop(); // new binary installed — exit so the service restarts on it
                        break;
                    }
                    // update failed: fall through (block if required, else keep working)
                }

                if (required) {
                    if (!blocked) {
                        blocked = true;
                        announceUpdateRequired(update, config);
                    }
                    // Outdated: keep heartbeating (stay visible) but do no work.
                } else {
                    if (blocked) {
                        blocked = false;
                        log.info('agent back within version policy — resuming task work');
                    }
                    await runCycleTasks(await client.getTasks(), config, client);
                }
            }
        } catch (err) {
            log.error(`poll cycle failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        await sleep(config.pollIntervalMs);
    }
}

function announceUpdateRequired(update, config) {
    const detail = `min ${update.min_version ?? '?'}, running ${VERSION}`;
    const from = update.download_url ? ` Download: ${update.download_url}` : '';

    if (config.autoUpdate) {
        log.warn(`update required (${detail}) but auto-update did not apply — halting task work.${from}`);
    } else {
        log.warn(`update required (${detail}). Halting task work until updated (auto-update is off).${from}`);
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
