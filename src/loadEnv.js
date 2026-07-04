import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal `.env` loader — no dependencies, so the published agent stays trivial to audit.
 * Parses `KEY=value` lines from `<repo>/.env` into `process.env` without overriding
 * values already set in the real environment. Not a full dotenv implementation:
 * supports comments (`#`), blank lines, and optional surrounding quotes.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(srcDir, '..', '.env');

if (existsSync(envPath)) {
    const contents = readFileSync(envPath, 'utf8');

    for (const rawLine of contents.split('\n')) {
        const line = rawLine.trim();

        if (line === '' || line.startsWith('#')) {
            continue;
        }

        const eq = line.indexOf('=');

        if (eq === -1) {
            continue;
        }

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key !== '' && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
