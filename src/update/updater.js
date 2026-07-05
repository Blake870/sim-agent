import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import { MINISIGN_PUBKEY } from '../pubkey.js';
import { VERSION } from '../version.js';
import { log } from '../util/log.js';
import { verifyMinisign } from './minisign.js';

/** Numeric semver compare — is `a` newer than `b`? */
export function isNewer(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0;
    }

    return false;
}

/** Running as a packaged single-executable (SEA)? Only then can it self-replace. */
async function isPackaged() {
    try {
        const sea = await import('node:sea');

        return typeof sea.isSea === 'function' ? sea.isSea() : false;
    } catch {
        return false; // node:sea unavailable → running from source
    }
}

/** Release asset suffix matching the build output (sim-agent-<token>). */
function platformToken() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    if (process.platform === 'win32') return `win-${arch}.exe`;
    if (process.platform === 'darwin') return `macos-${arch}`;

    return `linux-${arch}`;
}

function resolveUrl(downloadUrl) {
    return downloadUrl.includes('{platform}')
        ? downloadUrl.replace('{platform}', platformToken())
        : downloadUrl;
}

async function fetchBuffer(url) {
    const res = await fetch(url, { redirect: 'follow' });

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} for ${url}`);
    }

    return Buffer.from(await res.arrayBuffer());
}

/**
 * Download, verify (minisign) and install a new binary. Returns true if it was applied and
 * the process should exit to restart on it. Never throws: a failed update is logged and
 * returns false so the caller decides (block if required, keep working if optional).
 */
export async function performUpdate(update, config) {
    try {
        if (!MINISIGN_PUBKEY) {
            log.error('auto-update: no embedded signing key — refusing to update');

            return false;
        }

        if (!(await isPackaged())) {
            log.warn('auto-update: running from source, not a packaged binary — skipping self-update');

            return false;
        }

        const url = resolveUrl(update.download_url);
        log.info(`auto-update: downloading ${update.latest_version ?? ''} from ${url}`);

        const [binary, sigText] = await Promise.all([
            fetchBuffer(url),
            fetchBuffer(`${url}.minisig`).then((b) => b.toString('utf8')),
        ]);

        if (!verifyMinisign(binary, sigText, MINISIGN_PUBKEY)) {
            log.error('auto-update: signature verification FAILED — discarding download');

            return false;
        }
        log.info('auto-update: signature verified');

        applyBinary(binary);
        log.info(`auto-update: installed ${update.latest_version ?? ''} (was ${VERSION}); restarting`);

        return true;
    } catch (err) {
        log.error(`auto-update failed: ${err instanceof Error ? err.message : String(err)}`);

        return false;
    }
}

/** Replace the running executable with the new binary. The service manager restarts it. */
function applyBinary(binary) {
    const exe = process.execPath;
    const tmp = `${exe}.new`;

    writeFileSync(tmp, binary, { mode: 0o755 });
    chmodSync(tmp, 0o755);

    if (process.platform === 'win32') {
        // A running .exe can't be overwritten, but it can be renamed out of the way.
        try {
            renameSync(exe, `${exe}.old`);
        } catch {
            // ignore — .old may linger from a previous update
        }
        renameSync(tmp, exe);
    } else {
        renameSync(tmp, exe); // atomic replace; the running process keeps the old inode
    }
}

/** Best-effort cleanup of a leftover previous binary (Windows update trail). */
export function cleanupOldBinary() {
    try {
        rmSync(`${process.execPath}.old`, { force: true });
    } catch {
        // ignore
    }
}
