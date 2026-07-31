import pino from 'pino';

type LogFields = Readonly<Record<string, unknown>>;

const loggerInstance = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'discord-commerce' },
});

function fields(extra: LogFields | undefined): LogFields {
  return extra ?? {};
}

export const logger = loggerInstance;

export const log = {
  debug: (msg: string, extra?: LogFields) => loggerInstance.debug(fields(extra), msg),
  info: (msg: string, extra?: LogFields) => loggerInstance.info(fields(extra), msg),
  warn: (msg: string, extra?: LogFields) => loggerInstance.warn(fields(extra), msg),
  error: (msg: string, extra?: LogFields) => loggerInstance.error(fields(extra), msg),
  child: (bindings: LogFields) => {
    const childLogger = loggerInstance.child(bindings);
    return {
      debug: (msg: string, extra?: LogFields) => childLogger.debug(fields(extra), msg),
      info: (msg: string, extra?: LogFields) => childLogger.info(fields(extra), msg),
      warn: (msg: string, extra?: LogFields) => childLogger.warn(fields(extra), msg),
      error: (msg: string, extra?: LogFields) => childLogger.error(fields(extra), msg),
    } as const;
  },
} as const;
