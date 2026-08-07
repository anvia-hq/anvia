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
  LensEvalReporter,
  LensEvalReporterOptions,
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
};

export function createLensEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: LensTracing,
  options: LensEvalReporterOptions = {},
): LensEvalReporter<Input, Output, Expected> {
  const internal = (tracing as Partial<InternalLensTracing>)[internals];
  if (internal === undefined) {
    throw new TypeError("createLensEvalReporter requires a tracing instance from lens.create()");
  }
  return createOtelEvalReporter<Input, Output, Expected>({
    ...options,
    includeMetadata: options.includeMetadata ?? false,
    captureMaxBytes: internal.captureMaxBytes,
    transformInput: internal.transformInput,
    transformOutput: internal.transformOutput,
    logger: internal.logger,
  });
}

class LensAgentObserver implements InternalLensTracing {
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
