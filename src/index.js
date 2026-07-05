#!/usr/bin/env node
import './loadEnv.js';
import { loadConfig } from './config.js';
import { startPollLoop } from './core/pollLoop.js';
import { ensurePaired } from './pairing.js';
import { ensureMachineId, loadState, saveState } from './state.js';
import { createServerClient } from './transport/serverClient.js';
import { cleanupOldBinary } from './update/updater.js';
import { VERSION } from './version.js';
import { log } from './util/log.js';

process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

async function main() {
    const config = loadConfig();
    cleanupOldBinary(); // remove a leftover pre-update binary, if any

    log.info(`sim-agent v${VERSION} starting (demo=${config.demo}, poll=${config.pollIntervalMs}ms)`);

    if (config.demo) {
        // No server: run the task loop with synthetic tasks.
        await startPollLoop(config, null);

        return;
    }

    if (config.serverUrl === '') {
        log.error('AGENT_SERVER_URL is required (or set AGENT_DEMO=1 to run without a server)');
        process.exit(1);
    }

    const state = loadState();
    const machineId = ensureMachineId(state);

    // Auto-update preference lives in agent-state.json — the source of truth. Precedence:
    //   1. an explicit env value (AGENT_AUTO_UPDATE=0/1) sets/overrides it and is persisted;
    //   2. otherwise the stored value applies;
    //   3. a fresh install with neither records the default (on).
    // The effective value is always written back, so the state file reflects the real
    // setting and you can flip it there (edit "autoUpdate", restart) without touching the env.
    if (config.autoUpdateFromEnv) {
        if (state.autoUpdate !== config.autoUpdate) {
            state.autoUpdate = config.autoUpdate;
            saveState(state);
        }
    } else if (typeof state.autoUpdate === 'boolean') {
        config.autoUpdate = state.autoUpdate;
    } else {
        state.autoUpdate = config.autoUpdate;
        saveState(state);
    }

    const token = await ensurePaired(config, state, machineId);

    log.info(`machine ${machineId}`);

    if (config.pairOnly) {
        log.info('paired — exiting (AGENT_PAIR_ONLY)');

        return;
    }

    const client = createServerClient({ serverUrl: config.serverUrl, token });
    await startPollLoop(config, client);
}

main().catch((err) => {
    log.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
