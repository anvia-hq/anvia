import type { AgentRunStartArgs } from "@anvia/core/observability";
import { createOtelEvalReporter, otel } from "@anvia/otel";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { resolveLensConfig } from "./config.js";
import { createLensRedactor } from "./redaction.js";
import type {
  LensEvalIntegration,
  LensEvalReporter,
  LensEvalReporterOptions,
  LensEvalsOptions,
  LensFromEnvOptions,
  LensTracing,
  LensTracingOptions,
} from "./types.js";

const internals = Symbol("@anvia/lens.internals");

type LensInternals = {
  config: ReturnType<typeof resolveLensConfig>;
  loggerProvider: LoggerProvider;
  logger: ReturnType<LoggerProvider["getLogger"]>;
  captureMaxBytes: number;
  transformInput: ((value: unknown) => unknown) | undefined;
  transformOutput: ((value: unknown) => unknown) | undefined;
};

type InternalLensTracing = LensTracing & { [internals]: LensInternals };

export function getResolvedLensConfig(tracing: LensTracing) {
  return (tracing as Partial<InternalLensTracing>)[internals]?.config;
}

export const lens = {
  create(options: LensTracingOptions = {}): LensTracing {
    return new LensAgentObserver(options);
  },
  createFromEnv(options: LensFromEnvOptions = {}): LensTracing {
    const { optional, ...tracingOptions } = options;
    if (optional === true && !hasLensConnectionEnvironment()) {
      return new DisabledLensTracing();
    }
    return new LensAgentObserver(tracingOptions);
  },
  evals<Input = unknown, Output = unknown, Expected = unknown>(
    options: LensEvalsOptions = {},
  ): LensEvalIntegration<Input, Output, Expected> {
    const {
      publishInvalid,
      includeMetadata,
      includePayloads,
      onMissingTrace,
      flushOnRunEnd,
      ...tracingOptions
    } = options;
    const observer = lens.createFromEnv(tracingOptions);
    const reporterOptions: LensEvalReporterOptions = {
      flushOnRunEnd: flushOnRunEnd ?? true,
    };
    if (publishInvalid !== undefined) reporterOptions.publishInvalid = publishInvalid;
    if (includeMetadata !== undefined) reporterOptions.includeMetadata = includeMetadata;
    if (includePayloads !== undefined) reporterOptions.includePayloads = includePayloads;
    if (onMissingTrace !== undefined) reporterOptions.onMissingTrace = onMissingTrace;
    return {
      enabled: observer.enabled,
      observer,
      reporter: createLensEvalReporter<Input, Output, Expected>(observer, reporterOptions),
      async flush() {
        await observer.flush();
      },
      async shutdown() {
        await observer.shutdown();
      },
    };
  },
};

export function createLensEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: LensTracing,
  options: LensEvalReporterOptions = {},
): LensEvalReporter<Input, Output, Expected> {
  if (!tracing.enabled) {
    return {
      report() {},
      async onRunEnd() {
        if (options.flushOnRunEnd === true) await tracing.flush();
      },
    };
  }
  const internal = (tracing as Partial<InternalLensTracing>)[internals];
  if (internal === undefined) {
    throw new TypeError("createLensEvalReporter requires a tracing instance from lens.create()");
  }
  const reporter = createOtelEvalReporter<Input, Output, Expected>({
    ...options,
    includeMetadata: options.includeMetadata ?? false,
    captureMaxBytes: internal.captureMaxBytes,
    transformInput: internal.transformInput,
    transformOutput: internal.transformOutput,
    logger: internal.logger,
  });
  if (options.flushOnRunEnd !== true) return reporter;
  return {
    ...reporter,
    async onRunEnd(args) {
      await reporter.onRunEnd?.(args);
      await tracing.flush();
    },
  };
}

class LensAgentObserver implements InternalLensTracing {
  readonly enabled = true;
  readonly [internals]: LensInternals;
  private readonly tracerProvider: NodeTracerProvider;
  private readonly delegate: LensTracing;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: LensTracingOptions) {
    const config = resolveLensConfig(options);
    const authorization = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
    const headers = { Authorization: authorization };
    const resource = resourceFromAttributes({
      "service.name": config.serviceName,
      "deployment.environment.name": config.environment,
      "anvia.release": config.release,
    });
    const traceExporter = new OTLPTraceExporter({
      url: `${config.baseUrl}/api/public/otel/v1/traces`,
      headers,
      timeoutMillis: config.timeoutMs,
    });
    const logExporter = new OTLPLogExporter({
      url: `${config.baseUrl}/api/public/otel/v1/logs`,
      headers,
      timeoutMillis: config.timeoutMs,
    });
    this.tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(traceExporter)],
      forceFlushTimeoutMillis: config.timeoutMs,
    });
    const loggerProvider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor({ exporter: logExporter })],
      forceFlushTimeoutMillis: config.timeoutMs,
    });
    const logger = loggerProvider.getLogger("@anvia/lens", "0.1.0");
    const redactor = createLensRedactor(options.redaction);
    const transformInput = options.redactInputs ? redactor.redact : undefined;
    const transformOutput = options.redactOutputs ? redactor.redact : undefined;
    this[internals] = {
      config,
      loggerProvider,
      logger,
      captureMaxBytes: config.captureMaxBytes,
      transformInput,
      transformOutput,
    };

    this.delegate = otel.create({
      tracer: this.tracerProvider.getTracer("@anvia/lens", "0.1.0"),
      captureMode: config.captureMode,
      captureMaxBytes: config.captureMaxBytes,
      transformInput,
      transformOutput,
    }) as LensTracing;
  }

  startRun(args: AgentRunStartArgs) {
    return this.delegate.startRun(args);
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.tracerProvider.forceFlush(),
      this[internals].loggerProvider.forceFlush(),
    ]);
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= Promise.all([
      this.tracerProvider.shutdown(),
      this[internals].loggerProvider.shutdown(),
    ]).then(() => undefined);
    return this.shutdownPromise;
  }
}

class DisabledLensTracing implements LensTracing {
  readonly enabled = false;

  startRun() {
    return undefined;
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

function hasLensConnectionEnvironment(): boolean {
  return [
    process.env.ANVIA_LENS_BASE_URL,
    process.env.ANVIA_LENS_PUBLIC_KEY,
    process.env.ANVIA_LENS_SECRET_KEY,
  ].some((value) => value !== undefined && value.trim().length > 0);
}
