import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { log } from './util/log.js';

/**
 * The local accounts store — Steam (and optional CSFloat) credentials the agent operates
 * with. Secrets live ONLY here on the customer's machine; the server never receives them.
 * Defaults to accounts.json next to the working dir; override with AGENT_ACCOUNTS_PATH.
 *
 * File shape (version optional, absent = v1):
 *   { "version": 1, "accounts": [ { steam64_id, username, password, shared_secret,
 *     identity_secret, device_id?, csfloat_api_key?, label? } ] }
 * A bare array is also accepted.
 */
const ACCOUNTS_PATH = (process.env.AGENT_ACCOUNTS_PATH ?? '').trim() !== ''
    ? resolve(process.env.AGENT_ACCOUNTS_PATH)
    : resolve(process.cwd(), 'accounts.json');

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Read and parse the accounts store. Returns [] when the file is absent or unreadable —
 * a missing accounts file is a normal state (nothing configured yet), not a fatal error.
 *
 * @returns {Array<Record<string, unknown>>}
 */
export function loadAccounts() {
    if (!existsSync(ACCOUNTS_PATH)) {
        return [];
    }

    let parsed;

    try {
        parsed = JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'));
    } catch (err) {
        log.warn(`accounts file at ${ACCOUNTS_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }

    const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;

    return Array.isArray(accounts) ? accounts : [];
}

/**
 * Credential-presence status per account — presence booleans only, no secrets. This is what
 * the agent reports to the server for the per-machine badges.
 *
 * @param {Array<Record<string, unknown>>} accounts
 * @returns {Array<{ steam64_id: string, has_steam_credentials: boolean, has_csfloat_credentials: boolean }>}
 */
export function accountStatuses(accounts) {
    return accounts
        .filter((a) => filled(a.steam64_id))
        .map((a) => ({
            steam64_id: String(a.steam64_id).trim(),
            has_steam_credentials:
                filled(a.username) && filled(a.password) && filled(a.shared_secret) && filled(a.identity_secret),
            has_csfloat_credentials: filled(a.csfloat_api_key),
        }));
}
