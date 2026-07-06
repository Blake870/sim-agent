/**
 * A sleep you can cut short. The poll loop waits on it between cycles; a gateway poke
 * calls wake() to run the next lease immediately instead of waiting out the interval.
 * Poke is a latency optimization only — if it never fires, the wait simply times out
 * and the loop polls as usual.
 */
export function createWaker() {
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    /** @type {((reason: string) => void) | null} */
    let resolve = null;

    return {
        /**
         * Resolves after `ms`, or immediately when wake() is called.
         * @param {number} ms
         * @returns {Promise<string>} 'timeout' | 'poke'
         */
        wait(ms) {
            return new Promise((res) => {
                resolve = res;
                timer = setTimeout(() => {
                    timer = null;
                    resolve = null;
                    res('timeout');
                }, ms);
            });
        },

        /** Cut the current wait() short. No-op if nothing is waiting. */
        wake() {
            if (resolve !== null) {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }

                const res = resolve;
                resolve = null;
                res('poke');
            }
        },
    };
}
