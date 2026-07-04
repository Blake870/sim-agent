/**
 * Minimal timestamped logger. Never log secrets — task payloads/results may carry
 * Steam data, so callers pass only what is safe to print.
 */
function line(level, msg) {
    const ts = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`${ts} [${level}] ${msg}`);
}

export const log = {
    info: (msg) => line('info', msg),
    warn: (msg) => line('warn', msg),
    error: (msg) => line('error', msg),
};
