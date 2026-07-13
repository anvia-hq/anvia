import { resolveLogLevel, shouldLog } from "./levels";
import type { LogContext, Logger, LoggerOptions, LogLevel } from "./types";

type ConsoleWriter = (line: string) => void;

export type ConsoleLoggerOptions = LoggerOptions & {
  writer?: ConsoleWriter | undefined;
  timestamp?: (() => Date) | undefined;
};

export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  return new ConsoleLogger({
    bindings: createInitialBindings(options),
    level: resolveLogLevel(options.level),
    writer: options.writer ?? console.log,
    timestamp: options.timestamp ?? (() => new Date()),
  });
}

type ConsoleLoggerState = {
  bindings: LogContext;
  level: LogLevel;
  writer: ConsoleWriter;
  timestamp: () => Date;
};

class ConsoleLogger implements Logger {
  constructor(private readonly state: ConsoleLoggerState) {}

  trace(message: string, context?: LogContext): void {
    this.write("trace", message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.write("fatal", message, context);
  }

  child(bindings: LogContext): Logger {
    return new ConsoleLogger({
      ...this.state,
      bindings: { ...this.state.bindings, ...bindings },
    });
  }

  private write(level: Exclude<LogLevel, "silent">, message: string, context?: LogContext): void {
    if (!shouldLog(this.state.level, level)) {
      return;
    }

    const payload: LogContext = {
      time: this.state.timestamp().toISOString(),
      level,
      msg: message,
      ...this.state.bindings,
    };
    Object.assign(payload, context);
    this.state.writer(JSON.stringify(payload));
  }
}

function createInitialBindings(options: LoggerOptions): LogContext {
  const bindings: LogContext = {};
  if (options.name !== undefined) {
    bindings.name = options.name;
  }
  Object.assign(bindings, options.bindings);
  return bindings;
}
