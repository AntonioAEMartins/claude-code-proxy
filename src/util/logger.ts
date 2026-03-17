type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: string): void {
  if (level in LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatLog(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (data) {
    Object.assign(entry, data);
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      process.stderr.write(formatLog('debug', message, data) + '\n');
    }
  },
  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      process.stderr.write(formatLog('info', message, data) + '\n');
    }
  },
  warn(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatLog('warn', message, data) + '\n');
    }
  },
  error(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      process.stderr.write(formatLog('error', message, data) + '\n');
    }
  },
};
