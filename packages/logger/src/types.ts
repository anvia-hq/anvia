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
}

export type LoggerOptions = {
  level?: LogLevel | undefined;
  name?: string | undefined;
  bindings?: LogContext | undefined;
};
