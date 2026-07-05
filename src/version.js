import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fromPackageJson() {
    try {
        const srcDir = dirname(fileURLToPath(import.meta.url));

        return JSON.parse(readFileSync(resolve(srcDir, '..', 'package.json'), 'utf8')).version;
    } catch {
        return '0.0.0';
    }
}

/**
 * The agent's own version, reported to the server on pair + heartbeat. The build injects
 * it as `__SIM_AGENT_VERSION__` (a packaged binary can't read package.json from disk);
 * running from source falls back to reading package.json.
 */
export const VERSION =
    typeof __SIM_AGENT_VERSION__ !== 'undefined' ? __SIM_AGENT_VERSION__ : fromPackageJson();
