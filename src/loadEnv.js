import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal `.env` loader — no dependencies, so the published agent stays trivial to audit.
 * Parses `KEY=value` lines from `.env` in the working directory into `process.env`
 * without overriding values already set in the real environment. Reading from cwd (not a
 * source-relative path) means it works identically when run from source or as a packaged
 * binary. Not a full dotenv implementation: supports comments (`#`), blank lines, quotes.
 */
const envPath = resolve(process.cwd(), '.env');

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
