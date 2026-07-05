#!/usr/bin/env node
import './loadEnv.js';
import { loadConfig } from './config.js';
import { startPollLoop } from './core/pollLoop.js';
import { ensurePaired } from './pairing.js';
import { ensureMachineId, loadState } from './state.js';
import { createServerClient } from './transport/serverClient.js';
import { VERSION } from './version.js';
import { log } from './util/log.js';

process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

async function main() {
    const config = loadConfig();

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
    const token = await ensurePaired(config, state, machineId);

    log.info(`machine ${machineId}`);

    const client = createServerClient({ serverUrl: config.serverUrl, token });
    await startPollLoop(config, client);
}

main().catch((err) => {
    log.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
