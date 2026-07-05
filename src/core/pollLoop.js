import { randomUUID } from 'node:crypto';

import { log } from '../util/log.js';
import { runTask } from './taskRunner.js';
import { isNewer, performUpdate } from '../update/updater.js';
import { VERSION } from '../version.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const noopSession = { nonce: null, requestId: null, persist() {}, revoke() {} };

/**
 * Heartbeat, check the server's version directive, then (if allowed) lease and run work.
 * Leasing advances the rolling anti-clone nonce (seat guard), so the loop threads the nonce
 * through getTasks and persists the new one. When the server requires an update the agent
 * stays alive and keeps heartbeating but does no work.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {ReturnType<import('../transport/serverClient.js').createServerClient>|null} client
 * @param {{ nonce: string|null, requestId: string|null, persist: () => void, revoke: () => void }} [session]
 */
export async function startPollLoop(config, client, session = noopSession) {
    let running = true;
    let blocked = false;
    let paused = false;

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

                    if (heartbeat?.maintenance === true) {
                        // Server put this agent's owner (or everyone) into maintenance: keep
                        // heartbeating so it stays visible, but pull no work until it lifts.
                        if (!paused) {
                            paused = true;
                            log.warn('server reports maintenance mode — pausing task work until it is lifted');
                        }
                    } else {
                        if (paused) {
                            paused = false;
                            log.info('maintenance lifted — resuming task work');
                        }

                        // A stable request id, reused across retries, lets a lost lease
                        // response be treated as an idempotent re-sync rather than a clone.
                        if (!session.requestId) {
                            session.requestId = randomUUID();
                            session.persist();
                        }

                        const { tasks, nonce } = await client.getTasks(session.nonce, session.requestId);

                        if (nonce) {
                            session.nonce = nonce;
                            session.requestId = null; // consumed — next lease uses a fresh id
                            session.persist();
                        }

                        await runCycleTasks(tasks, config, client);
                    }
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);

            if (err?.status === 401 || err?.status === 409) {
                // 401 = token no longer resolves; 409 = machine_mismatch / agent_cloned. Either
                // way this pairing was revoked (another machine is using the seat). Clear the
                // dead credentials so we don't hot-loop, and exit so the service restarts and
                // re-pairs (with a fresh code) instead of replaying an invalid token forever.
                log.error(`this machine's pairing was revoked by the server (${msg}). Re-pair it from the sim panel.`);
                session.revoke();
                running = false;
                process.exitCode = 1;
                break;
            }

            log.error(`poll cycle failed: ${msg}`);
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
