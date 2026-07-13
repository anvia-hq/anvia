import pino, {
  type DestinationStream,
  type LoggerOptions as PinoBaseOptions,
  type Logger as PinoLoggerInstance,
} from "pino";
import { resolveLogLevel } from "./levels";
import type { LogContext, Logger, LoggerOptions } from "./types";

export type PinoLoggerOptions = LoggerOptions & {
  pinoOptions?: PinoBaseOptions | undefined;
  destination?: DestinationStream | undefined;
};

export function createPinoLogger(options: PinoLoggerOptions = {}): Logger {
  const pinoOptions: PinoBaseOptions = {
    ...options.pinoOptions,
    level: options.pinoOptions?.level ?? resolveLogLevel(options.level),
  };
  if (options.name !== undefined) pinoOptions.name = options.name;
  if (options.bindings !== undefined) pinoOptions.base = options.bindings;

  const instance =
    options.destination === undefined ? pino(pinoOptions) : pino(pinoOptions, options.destination);

  return new PinoLogger(instance);
}

class PinoLogger implements Logger {
  constructor(private readonly logger: PinoLoggerInstance) {}

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
    return new PinoLogger(this.logger.child(bindings));
  }

  private write(
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
    message: string,
    context?: LogContext,
  ): void {
    if (context === undefined) {
      this.logger[level](message);
      return;
    }

    this.logger[level](context, message);
  }
}
