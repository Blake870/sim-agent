/**
 * Thin HTTPS client for the sim server's agent API. Outbound-only: the agent pulls work
 * and reports results — the server never connects to the agent. No business logic here,
 * only request/response plumbing.
 */
export function createServerClient({ serverUrl, token, machineId = null }) {
    async function request(method, path, { body, auth = true, headers: extra = {} } = {}) {
        const headers = { accept: 'application/json', 'content-type': 'application/json', ...extra };

        if (auth && token) {
            headers.authorization = `Bearer ${token}`;
        }

        // Binds every authenticated request to the paired machine (server-side clone guard).
        if (machineId) {
            headers['x-agent-machine'] = machineId;
        }

        const res = await fetch(`${serverUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        const text = await res.text().catch(() => '');
        let data = null;

        if (text !== '') {
            try {
                data = JSON.parse(text);
            } catch {
                // Non-JSON body — leave data null.
            }
        }

        if (!res.ok) {
            const detail = data?.error ?? `${res.status} ${res.statusText}`;
            const error = new Error(`${method} ${path} -> ${detail}`.trim());
            error.status = res.status;
            throw error;
        }

        return data;
    }

    return {
        /**
         * Exchange a one-time pairing code for a permanent token. Unauthenticated — the
         * code is the credential. Returns `{ token, agent_id, next_poll_ms }`.
         */
        pair(code, machineId, version) {
            return request('POST', '/api/agent/pair', {
                auth: false,
                body: { code, machine_id: machineId, version },
            });
        },

        /** Prove liveness and report the running version. Carries no nonce (seat guard is on tasks). */
        heartbeat(version) {
            return request('POST', '/api/agent/heartbeat', { body: { version } });
        },

        /**
         * Lease work. Advances the rolling anti-clone nonce, so the current `nonce` is sent and
         * a fresh one comes back to persist. `requestId` is stable across retries of the SAME
         * request so a lost response is treated as an idempotent re-sync, not a clone.
         * @returns {Promise<{ tasks: any[], nonce: string|null }>}
         */
        async getTasks(nonce = null, requestId = null) {
            try {
                const data = await request('GET', '/api/agent/tasks', {
                    headers: {
                        ...(nonce ? { 'x-agent-nonce': nonce } : {}),
                        ...(requestId ? { 'x-agent-lease-id': requestId } : {}),
                    },
                });

                return { tasks: data?.tasks ?? [], nonce: data?.nonce ?? null };
            } catch (error) {
                // 404: tasks endpoint not deployed yet. 426: agent below required version
                // (the poll loop already gates on the heartbeat directive; this is a guard).
                if (error.status === 404 || error.status === 426) {
                    return { tasks: [], nonce: null };
                }
                throw error;
            }
        },

        /**
         * Report a completed (or failed) task.
         * @param {string|number} taskId
         * @param {{ ok: boolean, result?: unknown, error?: string }} outcome
         */
        postResult(taskId, outcome) {
            return request('POST', `/api/agent/tasks/${taskId}/result`, { body: outcome });
        },
    };
}
