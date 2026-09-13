export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export type LogContext = Record<string, unknown>;

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
  /**
   * Flush buffered records to the destination. Optional so existing custom
   * `Logger` implementations stay assignable; every logger created by this
   * package implements it, and both factories return a `FlushableLogger`.
   */
  flush?(): Promise<void>;
}

/** A `Logger` whose `flush` method is always present, including on child loggers. */
export interface FlushableLogger extends Logger {
  flush(): Promise<void>;
  child(bindings: LogContext): FlushableLogger;
}

export type LoggerOptions = {
  level?: LogLevel | undefined;
  name?: string | undefined;
  bindings?: LogContext | undefined;
};
