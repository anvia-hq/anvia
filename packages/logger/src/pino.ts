import pino, {
  type DestinationStream,
  type LoggerOptions as PinoBaseOptions,
  type Logger as PinoLoggerInstance,
} from "pino";
import { resolveLogLevel } from "./levels";
import type { FlushableLogger, LogContext, Logger, LoggerOptions } from "./types";

export type PinoLoggerOptions = LoggerOptions & {
  pinoOptions?: PinoBaseOptions | undefined;
  /**
   * A caller-supplied destination stream. Streams exposing `flushSync` or
   * `flush`, such as Pino destinations, are drained by `flush()`. A plain
   * writable such as `fs.createWriteStream` has no flush API, so prefer
   * `filePath` when records must survive an abrupt exit.
   */
  destination?: DestinationStream | undefined;
  /**
   * Write records to a file. Parent directories are created when `mkdir` is
   * enabled. Call `flush()` before shutdown to drain a buffered destination.
   */
  filePath?: string | undefined;
  /**
   * Write each record synchronously instead of buffering it. Defaults to
   * `true` so records are not lost on an abrupt `process.exit()`. Set to
   * `false` for higher throughput, and call `flush()` before exiting.
   * Only valid with `filePath`.
   */
  sync?: boolean | undefined;
  /** Create missing parent directories for `filePath`. Defaults to `true`. Only valid with `filePath`. */
  mkdir?: boolean | undefined;
  /** Append to an existing `filePath` instead of truncating it. Defaults to `true`. Only valid with `filePath`. */
  append?: boolean | undefined;
};

export function createPinoLogger(options: PinoLoggerOptions = {}): FlushableLogger {
  const pinoOptions: PinoBaseOptions = {
    ...options.pinoOptions,
    level: options.pinoOptions?.level ?? resolveLogLevel(options.level),
  };
  if (options.name !== undefined) pinoOptions.name = options.name;
  if (options.bindings !== undefined) pinoOptions.base = options.bindings;

  const destination = resolveDestination(options);

  const instance = destination === undefined ? pino(pinoOptions) : pino(pinoOptions, destination);

  return new PinoLogger(instance, destination);
}

function resolveDestination(options: PinoLoggerOptions): DestinationStream | undefined {
  if (options.filePath === undefined) {
    if (options.sync !== undefined || options.mkdir !== undefined || options.append !== undefined) {
      throw new Error(
        "@anvia/logger: sync, mkdir, and append only apply to file destinations; pass filePath to use them.",
      );
    }

    if (options.destination !== undefined && options.pinoOptions?.transport !== undefined) {
      throw new Error(
        "@anvia/logger: pass either destination or pinoOptions.transport, not both; Pino ignores the destination stream when a transport is configured.",
      );
    }

    return options.destination;
  }

  if (options.destination !== undefined) {
    throw new Error("@anvia/logger: pass either filePath or destination, not both.");
  }

  if (options.pinoOptions?.transport !== undefined) {
    throw new Error("@anvia/logger: pass either filePath or pinoOptions.transport, not both.");
  }

  return pino.destination({
    dest: options.filePath,
    sync: options.sync ?? true,
    mkdir: options.mkdir ?? true,
    append: options.append ?? true,
  });
}

type StreamListener = (error?: Error) => void;

type FlushableStream = DestinationStream & {
  destroyed?: boolean | undefined;
  fd?: number | undefined;
  flush?: ((callback: StreamListener) => void) | undefined;
  flushSync?: (() => void) | undefined;
  once?: ((event: "ready" | "error", listener: StreamListener) => unknown) | undefined;
  removeListener?: ((event: "ready" | "error", listener: StreamListener) => unknown) | undefined;
};

class PinoLogger implements Logger {
  constructor(
    private readonly logger: PinoLoggerInstance,
    private readonly destination: DestinationStream | undefined,
  ) {}

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

  child(bindings: LogContext): FlushableLogger {
    return new PinoLogger(this.logger.child(bindings), this.destination);
  }

  flush(): Promise<void> {
    if (this.destination === undefined) {
      // Pino owns the stream: the default stdout destination, or a worker
      // created by `pinoOptions.transport`. Delegate to Pino's own flush.
      return flushPinoInstance(this.logger);
    }

    return flushStream(this.destination as FlushableStream);
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

function flushPinoInstance(logger: PinoLoggerInstance): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    logger.flush((error?: Error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

/**
 * Flush every buffered record to a destination stream.
 *
 * Pino's callback-style `flush` returns immediately when the destination has no
 * minimum buffered length, so a synchronous flush is preferred: it writes all
 * pending buffers. Pino's `flushSync` throws before a file descriptor is open,
 * so a destination that is still opening is awaited first instead of dropping
 * the flush.
 */
function flushStream(stream: FlushableStream): Promise<void> {
  if (stream.destroyed === true) {
    return Promise.resolve();
  }

  const flushSync = stream.flushSync;
  if (flushSync !== undefined) {
    return waitUntilReady(stream).then(() => {
      flushSync.call(stream);
    });
  }

  const flush = stream.flush;
  if (flush !== undefined) {
    return new Promise<void>((resolve, reject) => {
      flush.call(stream, (error?: Error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  }

  // A plain writable, such as `fs.createWriteStream`, exposes no flush API and
  // offers nothing further to await.
  return Promise.resolve();
}

function waitUntilReady(stream: FlushableStream): Promise<void> {
  const { fd, once, removeListener } = stream;
  if (fd === undefined || fd >= 0 || once === undefined) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const detach = () => {
      removeListener?.call(stream, "ready", onReady);
      removeListener?.call(stream, "error", onError);
    };
    const onReady: StreamListener = () => {
      detach();
      resolve();
    };
    const onError: StreamListener = (error) => {
      detach();
      reject(error ?? new Error("Log destination failed before it was ready."));
    };

    once.call(stream, "ready", onReady);
    once.call(stream, "error", onError);
  });
}
