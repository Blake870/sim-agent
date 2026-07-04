import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(srcDir, '..', 'package.json'), 'utf8'));

/** The agent's own version, reported to the server on pair + heartbeat. */
export const VERSION = pkg.version;
