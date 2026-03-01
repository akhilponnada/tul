/**
 * Tul Logger - Configurable logging with levels and colors
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private useColors: boolean;

  constructor(level: LogLevel = 'warn', prefix = '[tul]') {
    this.level = level;
    this.prefix = prefix;
    // Detect if colors are supported (not in CI, has TTY)
    this.useColors = process.stdout.isTTY ?? false;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private color(color: keyof typeof COLORS, text: string): string {
    if (!this.useColors) return text;
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }

  private formatPrefix(level: string): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = this.color('cyan', this.prefix);
    const time = this.color('dim', timestamp);
    return `${prefix} ${time} ${level}`;
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      const prefix = this.formatPrefix(this.color('dim', 'DEBUG'));
      console.log(prefix, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const prefix = this.formatPrefix(this.color('blue', 'INFO'));
      console.log(prefix, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      const prefix = this.formatPrefix(this.color('yellow', 'WARN'));
      console.warn(prefix, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog('error')) {
      const prefix = this.formatPrefix(this.color('red', 'ERROR'));
      console.error(prefix, ...args);
    }
  }

  success(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const prefix = this.formatPrefix(this.color('green', '✓'));
      console.log(prefix, ...args);
    }
  }

  /**
   * Log a divider line (for verbose mode reports)
   */
  divider(char = '─', length = 50): void {
    if (this.shouldLog('info')) {
      console.log(this.color('dim', char.repeat(length)));
    }
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    if (this.shouldLog('info')) {
      const prefix = this.color('cyan', this.prefix);
      const header = this.color('magenta', title);
      console.log(`${prefix} ${header} ${'─'.repeat(Math.max(0, 40 - title.length))}`);
    }
  }

  /**
   * Log key-value pairs (for stats)
   */
  stat(key: string, value: unknown): void {
    if (this.shouldLog('info')) {
      const formattedKey = this.color('dim', `  ${key}:`);
      console.log(formattedKey, value);
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): Logger {
    const childLogger = new Logger(this.level, `${this.prefix}:${subPrefix}`);
    childLogger.useColors = this.useColors;
    return childLogger;
  }
}

// Global logger instance
let globalLogger = new Logger('warn');

export function getLogger(): Logger {
  return globalLogger;
}

export function setGlobalLogLevel(level: LogLevel): void {
  globalLogger.setLevel(level);
}

export function createLogger(level: LogLevel = 'warn'): Logger {
  return new Logger(level);
}

export default globalLogger;
