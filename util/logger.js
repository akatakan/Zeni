const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, message, meta) {
    if (LEVELS[level] < CURRENT) return;
    const ts = new Date().toISOString();
    const line = meta
        ? `[${ts}] [${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}`
        : `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

module.exports = {
    debug: (msg, meta) => log('debug', msg, meta),
    info:  (msg, meta) => log('info',  msg, meta),
    warn:  (msg, meta) => log('warn',  msg, meta),
    error: (msg, meta) => log('error', msg, meta),
};
