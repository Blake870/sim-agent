import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUILD_DIR, BUNDLE_FILE, bundleAgent } from './bundle.mjs';

/**
 * Builds a standalone binary for the *current* platform using Node's Single Executable
 * Applications (SEA): official `node` + an injected code blob. Cross-platform builds come
 * from the CI matrix (one runner per OS). Requires Node >= 20.
 */
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
    console.error(`Node >= 20 is required to build the SEA binary (have ${process.versions.node}).`);
    process.exit(1);
}

const { version } = await bundleAgent();

// 1. Generate the SEA blob from the bundled entry.
const seaConfig = resolve(BUILD_DIR, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({
    main: BUNDLE_FILE,
    output: resolve(BUILD_DIR, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 2. Copy the running node binary as the base for our executable.
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const osName = isWindows ? 'win' : isMac ? 'macos' : 'linux';
const binName = `sim-agent-${osName}-${process.arch}${isWindows ? '.exe' : ''}`;
const binPath = resolve(BUILD_DIR, binName);
copyFileSync(process.execPath, binPath);

// 3. Inject the blob (postject). macOS needs a segment name + re-sign.
const postjectArgs = [
    'postject', binPath, 'NODE_SEA_BLOB', resolve(BUILD_DIR, 'sea-prep.blob'),
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (isMac) {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
execFileSync('npx', ['--yes', ...postjectArgs], { stdio: 'inherit', shell: isWindows });

console.log(`built sim-agent v${version} -> ${binPath}`);
