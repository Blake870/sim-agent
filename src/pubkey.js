import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fromDisk() {
    try {
        const srcDir = dirname(fileURLToPath(import.meta.url));

        return readFileSync(resolve(srcDir, '..', 'keys', 'minisign.pub'), 'utf8');
    } catch {
        return '';
    }
}

/**
 * The minisign public key used to verify downloaded updates. Baked in at build time
 * (from keys/minisign.pub); read from disk when running from source.
 */
export const MINISIGN_PUBKEY =
    typeof __SIM_AGENT_MINISIGN_PUBKEY__ !== 'undefined' ? __SIM_AGENT_MINISIGN_PUBKEY__ : fromDisk();
