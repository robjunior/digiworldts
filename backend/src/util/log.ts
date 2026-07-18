/**
 * Structured console logger. Deliberately tiny — no external deps, no
 * transports. Every line is one JSON object so it plays nicely with
 * `jq` and any downstream log shipper. Levels: debug/info/warn/error.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = ((): Level => {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info') as Level;
})();

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[envLevel]) return;
  const payload = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(extra ?? {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
  child: (bindings: Record<string, unknown>) => ({
    debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, { ...bindings, ...(extra ?? {}) }),
    info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, { ...bindings, ...(extra ?? {}) }),
    warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, { ...bindings, ...(extra ?? {}) }),
    error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, { ...bindings, ...(extra ?? {}) }),
  }),
} as const;
