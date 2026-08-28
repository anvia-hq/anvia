import type { EvalReporter } from "@anvia/core/evals";
import type { AgentObserver, AgentRunStartArgs } from "@anvia/core/observability";
import type { PipelineObserver, PipelineRunStartArgs } from "@anvia/core/pipeline";
import {
  createOtelEvalReporter,
  createOtelObserver,
  createOtelPipelineObserver,
  createOtelScorer,
  type OtelScorer,
} from "@anvia/otel";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { type ResolvedLensConfig, resolveLensConfig } from "./config.js";
import { createLensDatasetClient } from "./dataset-client.js";
import { createLensRedactor } from "./redaction.js";
import type {
  LensClientOptions,
  LensDatasetClient,
  LensDatasetClientOptions,
  LensDatasetGetOptions,
  LensEvalReporter,
  LensEvalReporterOptions,
  LensObserverOptions,
  LensPipelineObserverOptions,
  LensScoreArgs,
} from "./types.js";

type LensResources = {
  readonly tracerProvider: NodeTracerProvider;
  readonly loggerProvider: LoggerProvider;
  readonly tracer: ReturnType<NodeTracerProvider["getTracer"]>;
  readonly logger: ReturnType<LoggerProvider["getLogger"]>;
  readonly scorer: OtelScorer;
};

export class LensClient {
  readonly enabled: boolean;
  private readonly config: ResolvedLensConfig | undefined;
  private resource: LensResources | undefined;
  private initialization: Promise<LensResources> | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: LensClientOptions = {}) {
    if (options.optional === true && !hasLensConnectionEnvironment(options)) {
      this.enabled = false;
      this.config = undefined;
      return;
    }
    this.enabled = true;
    this.config = resolveLensConfig(options);
  }

  observer(options: LensObserverOptions = {}): AgentObserver {
    this.assertOpen();
    if (!this.enabled) {
      return {
        startRun: () => {
          this.assertOpen();
          return undefined;
        },
      };
    }
    const client = this;
    return {
      async startRun(args: AgentRunStartArgs) {
        const resource = await client.resources();
        return createOtelObserver(client.otelObserverOptions(resource, options)).startRun(args);
      },
    };
  }

  pipelineObserver(options: LensPipelineObserverOptions = {}): PipelineObserver {
    this.assertOpen();
    if (!this.enabled) {
      return {
        startRun: () => {
          this.assertOpen();
          return undefined;
        },
      };
    }
    const client = this;
    return {
      async startRun(args: PipelineRunStartArgs) {
        const resource = await client.resources();
        return createOtelPipelineObserver(client.otelObserverOptions(resource, options)).startRun(
          args,
        );
      },
    };
  }

  evalReporter<Input = unknown, Output = unknown, Expected = unknown>(
    options: LensEvalReporterOptions = {},
  ): LensEvalReporter<Input, Output, Expected> {
    this.assertOpen();
    if (!this.enabled) {
      return {
        report: () => {
          this.assertOpen();
        },
      };
    }
    let reporter: EvalReporter<Input, Output, Expected> | undefined;
    const resolve = async () => {
      this.assertOpen();
      reporter ??= createOtelEvalReporter<Input, Output, Expected>({
        ...options,
        traceObserver: options.traceObserver ?? "lens",
        includeMetadata: options.includeMetadata ?? false,
        logger: (await this.resources()).logger,
      });
      return reporter;
    };
    return {
      async onRunStart(args) {
        await (await resolve()).onRunStart?.(args);
      },
      async report(args) {
        await (await resolve()).report(args);
      },
      async onRunEnd(args) {
        await (await resolve()).onRunEnd?.(args);
      },
    };
  }

  async score(args: LensScoreArgs): Promise<void> {
    this.assertOpen();
    if (!this.enabled) return;
    (await this.resources()).scorer.score(args);
  }

  datasetClient(options: LensDatasetClientOptions = {}): LensDatasetClient {
    this.assertOpen();
    if (this.config === undefined) {
      throw new Error("LensClient is disabled because no connection is configured.");
    }
    const datasets = createLensDatasetClient(this.config, options);
    return {
      getDataset: <Input = unknown, Expected = unknown>(getOptions: LensDatasetGetOptions) => {
        this.assertOpen();
        return datasets.getDataset<Input, Expected>(getOptions);
      },
    };
  }

  async flush(): Promise<void> {
    this.assertOpen();
    const resource =
      this.resource ?? (this.initialization === undefined ? undefined : await this.initialization);
    if (resource === undefined) return;
    await Promise.all([resource.tracerProvider.forceFlush(), resource.loggerProvider.forceFlush()]);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private resources(): Promise<LensResources> {
    this.assertOpen();
    if (this.config === undefined) {
      return Promise.reject(
        new Error("LensClient is disabled because no connection is configured."),
      );
    }
    if (this.resource !== undefined) return Promise.resolve(this.resource);
    this.initialization ??= Promise.resolve()
      .then(() => createLensResources(this.config as ResolvedLensConfig))
      .then((resource) => {
        this.resource = resource;
        return resource;
      })
      .catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  private otelObserverOptions(resource: LensResources, overrides: LensObserverOptions) {
    const config = this.config as ResolvedLensConfig;
    const redactor = createLensRedactor(overrides.redaction ?? this.options.redaction);
    const redactInputs = overrides.redactInputs ?? this.options.redactInputs;
    const redactOutputs = overrides.redactOutputs ?? this.options.redactOutputs;
    return {
      tracer: resource.tracer,
      captureMode: overrides.captureMode ?? config.captureMode,
      captureMaxBytes: overrides.captureMaxBytes ?? config.captureMaxBytes,
      transformInput: redactInputs ? redactor.redact : undefined,
      transformOutput: redactOutputs ? redactor.redact : undefined,
    } as const;
  }

  private async closeResources(): Promise<void> {
    this.closed = true;
    const pending =
      this.resource === undefined ? this.initialization : Promise.resolve(this.resource);
    if (pending === undefined) return;
    let resource: LensResources;
    try {
      resource = await pending;
    } catch {
      return;
    }
    const settled = await Promise.allSettled([
      resource.tracerProvider.shutdown(),
      resource.loggerProvider.shutdown(),
    ]);
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) throw new AggregateError(failures, "Failed to close LensClient.");
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("LensClient is closed.");
  }
}

async function createLensResources(config: ResolvedLensConfig): Promise<LensResources> {
  const authorization = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
  const headers = { Authorization: authorization };
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "deployment.environment.name": config.environment,
    "anvia.release": config.release,
  });
  let tracerProvider: NodeTracerProvider | undefined;
  let loggerProvider: LoggerProvider | undefined;
  try {
    tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${config.baseUrl}/api/public/otel/v1/traces`,
            headers,
            timeoutMillis: config.timeoutMs,
          }),
        ),
      ],
      forceFlushTimeoutMillis: config.timeoutMs,
    });
    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${config.baseUrl}/api/public/otel/v1/logs`,
            headers,
            timeoutMillis: config.timeoutMs,
          }),
          exportTimeoutMillis: config.timeoutMs,
        }),
      ],
    });
    const logger = loggerProvider.getLogger("@anvia/lens", "1.0.0");
    return {
      tracerProvider,
      loggerProvider,
      tracer: tracerProvider.getTracer("@anvia/lens", "1.0.0"),
      logger,
      scorer: createOtelScorer({ logger }),
    };
  } catch (error) {
    await Promise.allSettled([
      tracerProvider?.shutdown() ?? Promise.resolve(),
      loggerProvider?.shutdown() ?? Promise.resolve(),
    ]);
    throw error;
  }
}

function hasLensConnectionEnvironment(options: LensClientOptions): boolean {
  return [
    options.baseUrl,
    options.publicKey,
    options.secretKey,
    process.env.ANVIA_LENS_BASE_URL,
    process.env.ANVIA_LENS_PUBLIC_KEY,
    process.env.ANVIA_LENS_SECRET_KEY,
  ].some((value) => value !== undefined && value.trim().length > 0);
}
