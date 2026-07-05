import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_DIR = resolve(ROOT, 'build');
export const BUNDLE_FILE = resolve(BUILD_DIR, 'agent.cjs');

/** Bundle the ESM agent into a single CommonJS file with the version baked in. */
export async function bundleAgent() {
    const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
    const pubKeyPath = resolve(ROOT, 'keys/minisign.pub');
    const pubKey = existsSync(pubKeyPath) ? readFileSync(pubKeyPath, 'utf8') : '';

    mkdirSync(BUILD_DIR, { recursive: true });

    await build({
        entryPoints: [resolve(ROOT, 'src/index.js')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        outfile: BUNDLE_FILE,
        define: {
            __SIM_AGENT_VERSION__: JSON.stringify(version),
            __SIM_AGENT_SERVER_URL__: JSON.stringify((process.env.SIM_AGENT_SERVER_URL ?? '').trim()),
            __SIM_AGENT_MINISIGN_PUBKEY__: JSON.stringify(pubKey),
        },
        legalComments: 'none',
    });

    return { version, out: BUNDLE_FILE };
}

// `node scripts/bundle.mjs`
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    bundleAgent().then(({ out, version }) => console.log(`bundled v${version} -> ${out}`));
}
