import type { Message } from "@anvia/core/completion";
import type { EvalReporter } from "@anvia/core/evals";
import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentGenerationUpdateArgs,
  AgentObserver,
  AgentObserverTraceInfo,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunEventArgs,
  AgentRunObserver,
  AgentRunPromptRef,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
} from "@anvia/core/observability";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseAgent,
  LangfuseEvent,
  type LangfuseEventAttributes,
  LangfuseGeneration,
  type LangfuseGenerationAttributes,
  LangfuseGuardrail,
  LangfuseOtelSpanAttributes,
  LangfuseSpan,
  LangfuseTool,
} from "@langfuse/tracing";
import {
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { sanitizeTraceValue, validateCaptureMaxBytes } from "./capture.js";
import {
  type LangfuseResolvedConfig,
  langfuseResolvedConfigSymbol,
  resolveLangfuseConfig,
} from "./config.js";
import { createLangfuseDatasetClient } from "./dataset-client.js";
import { createLangfuseEvalReporter } from "./eval-reporter.js";
import {
  type LangfuseEvalExperimentOptions,
  type LangfuseEvalExperimentResult,
  runLangfuseEvalExperiment,
} from "./experiment-runner.js";
import {
  agentLabel,
  childMetadata,
  errorMessage,
  generationKey,
  isRecord,
  modelInputMessage,
  modelInputMessages,
  modelParameters,
  usageDetails,
  usageDetailsFromRecord,
} from "./helpers.js";
import { createLangfusePromptClient } from "./prompt-client.js";
import { createPiiRedactor, type PiiRedactor } from "./redaction.js";
import { ScoreQueue } from "./scoring.js";
import type {
  LangfuseCaptureMode,
  LangfuseClientOptions,
  LangfuseDatasetClient,
  LangfuseDatasetClientOptions,
  LangfuseDatasetItem,
  LangfuseEvalReporterOptions,
  LangfuseObserverOptions,
  LangfusePromptClient,
  LangfusePromptClientOptions,
  LangfuseRedactionMode,
  LangfuseRunExperimentOptions,
  LangfuseScoreArgs,
} from "./types.js";

type LangfuseResources = {
  readonly processor: LangfuseSpanProcessor;
  readonly provider: NodeTracerProvider;
  readonly observations: LangfuseObservationFactory;
  readonly queue: ScoreQueue | null;
};

type LangfuseCapture = {
  readonly redactor: PiiRedactor | undefined;
  readonly redactInputs: LangfuseRedactionMode | undefined;
  readonly redactOutputs: LangfuseRedactionMode | undefined;
  readonly captureMode: LangfuseCaptureMode;
  readonly captureMaxBytes: number;
};

type LangfuseParent = { readonly otelSpan: Span } | SpanContext;

class LangfuseObservationFactory {
  constructor(private readonly tracer: Tracer) {}

  agent(
    name: string,
    attributes: Parameters<LangfuseAgent["update"]>[0],
    parent?: LangfuseParent | undefined,
  ): LangfuseAgent {
    return new LangfuseAgent({ otelSpan: this.startSpan(name, parent), attributes });
  }

  span(
    name: string,
    attributes: Parameters<LangfuseSpan["update"]>[0],
    parent: LangfuseParent,
  ): LangfuseSpan {
    return new LangfuseSpan({ otelSpan: this.startSpan(name, parent), attributes });
  }

  generation(
    name: string,
    attributes: LangfuseGenerationAttributes,
    parent: LangfuseParent,
  ): LangfuseGeneration {
    return new LangfuseGeneration({ otelSpan: this.startSpan(name, parent), attributes });
  }

  tool(
    name: string,
    attributes: Parameters<LangfuseTool["update"]>[0],
    parent: LangfuseParent,
  ): LangfuseTool {
    return new LangfuseTool({ otelSpan: this.startSpan(name, parent), attributes });
  }

  guardrail(
    name: string,
    attributes: Parameters<LangfuseGuardrail["update"]>[0],
    parent: LangfuseParent,
  ): LangfuseGuardrail {
    return new LangfuseGuardrail({ otelSpan: this.startSpan(name, parent), attributes });
  }

  event(
    name: string,
    attributes: LangfuseEventAttributes,
    parent: LangfuseParent,
    timestamp?: Date | undefined,
  ): LangfuseEvent {
    const endTime = timestamp ?? new Date();
    return new LangfuseEvent({
      otelSpan: this.startSpan(name, parent, timestamp),
      attributes,
      timestamp: endTime,
    });
  }

  private startSpan(name: string, parent?: LangfuseParent, startTime?: Date): Span {
    const parentContext =
      parent === undefined
        ? ROOT_CONTEXT
        : "otelSpan" in parent
          ? trace.setSpan(ROOT_CONTEXT, parent.otelSpan)
          : trace.setSpanContext(ROOT_CONTEXT, parent);
    return this.tracer.startSpan(name, startTime === undefined ? {} : { startTime }, parentContext);
  }
}

export class LangfuseClient {
  readonly [langfuseResolvedConfigSymbol]: LangfuseResolvedConfig;
  private readonly publicKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;
  private readonly serviceName: string | undefined;
  private readonly timeoutMs: number;
  private readonly options: LangfuseClientOptions;
  private resource: LangfuseResources | undefined;
  private initialization: Promise<LangfuseResources> | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(options: LangfuseClientOptions = {}) {
    this.options = options;
    const resolvedConfig = resolveLangfuseConfig(options);
    this[langfuseResolvedConfigSymbol] = resolvedConfig;
    this.publicKey = resolvedConfig.publicKey;
    this.secretKey = resolvedConfig.secretKey;
    this.baseUrl = resolvedConfig.baseUrl;
    this.serviceName = resolvedConfig.serviceName;
    this.timeoutMs = resolvedConfig.timeoutMs;
  }

  observer(options: LangfuseObserverOptions = {}): AgentObserver {
    this.assertOpen();
    return new LangfuseAgentObserver(this, resolveLangfuseCapture(options));
  }

  evalReporter<Input = unknown, Output = unknown, Expected = unknown>(
    options: LangfuseEvalReporterOptions = {},
  ): EvalReporter<Input, Output, Expected> {
    this.assertOpen();
    const reporter = createLangfuseEvalReporter<Input, Output, Expected>(this, options);
    return {
      report: (args) => {
        this.assertOpen();
        return reporter.report(args);
      },
    };
  }

  promptClient(options: LangfusePromptClientOptions = {}): LangfusePromptClient {
    this.assertOpen();
    const prompts = createLangfusePromptClient(this, options);
    return {
      getPrompt: (getOptions) => {
        this.assertOpen();
        return prompts.getPrompt(getOptions);
      },
      getPromptText: (getOptions) => {
        this.assertOpen();
        return prompts.getPromptText(getOptions);
      },
      getPromptChat: (getOptions) => {
        this.assertOpen();
        return prompts.getPromptChat(getOptions);
      },
      refresh: () => {
        this.assertOpen();
        prompts.refresh();
      },
    };
  }

  datasetClient(options: LangfuseDatasetClientOptions = {}): LangfuseDatasetClient {
    this.assertOpen();
    const datasets = createLangfuseDatasetClient(this, options);
    const client = this;
    return {
      createDataset(dataset) {
        client.assertOpen();
        return datasets.createDataset(dataset);
      },
      getDataset<Input, Expected>(getOptions: { name: string }) {
        client.assertOpen();
        return datasets.getDataset<Input, Expected>(getOptions);
      },
      upsertItems<Input, Expected>(upsertOptions: {
        name: string;
        items: readonly LangfuseDatasetItem<Input, Expected>[];
      }) {
        client.assertOpen();
        return datasets.upsertItems(upsertOptions);
      },
      runExperiment<Input, Output, Expected>(
        experimentOptions: LangfuseRunExperimentOptions<Input, Output, Expected>,
      ) {
        client.assertOpen();
        return datasets.runExperiment<Input, Output, Expected>(experimentOptions);
      },
    };
  }

  runEvalExperiment<Input, Output, Expected = unknown>(
    options: LangfuseEvalExperimentOptions<Input, Output, Expected>,
  ): Promise<LangfuseEvalExperimentResult<Input, Output, Expected>> {
    this.assertOpen();
    return runLangfuseEvalExperiment(this, options);
  }

  async startObservedRun(
    args: AgentRunStartArgs,
    capture: LangfuseCapture,
  ): Promise<AgentRunObserver> {
    const resource = await this.resources();
    const traceId = args.trace?.traceId;
    const capturedInput = captureInput(
      {
        instructions: args.instructions,
        prompt: args.prompt,
        history: args.history,
      },
      capture,
    );
    const capturedTraceMetadata = captureInput(args.trace?.metadata ?? {}, capture);
    const metadata: Record<string, unknown> = {
      agentName: args.agentName,
      agentDescription: args.agentDescription,
      maxTurns: args.maxTurns,
    };
    if (this.serviceName !== undefined) metadata.serviceName = this.serviceName;
    if (isRecord(capturedTraceMetadata)) {
      Object.assign(metadata, capturedTraceMetadata);
    } else {
      metadata.traceMetadata = capturedTraceMetadata;
    }
    const rootAttributes: Parameters<LangfuseAgent["update"]>[0] = {
      input: capturedInput,
      metadata,
    };
    if (args.trace?.version !== undefined) rootAttributes.version = args.trace.version;
    const root = resource.observations.agent(
      args.agentName ?? "agent.run",
      rootAttributes,
      traceId === undefined
        ? undefined
        : {
            traceId,
            spanId: "0000000000000001",
            traceFlags: TraceFlags.SAMPLED,
          },
    );
    applyTraceAttributes(root, args, capturedTraceMetadata);
    return new LangfuseRunObserver(
      root,
      resource.observations,
      { traceId: root.traceId, observationId: root.id },
      resolvePromptRef(args),
      capture,
    );
  }

  async flush(): Promise<void> {
    this.assertOpen();
    const resource =
      this.resource ?? (this.initialization === undefined ? undefined : await this.initialization);
    if (resource === undefined) return;
    await resource.queue?.flush();
    await resource.processor.forceFlush();
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  scoreQueueDepth(): number {
    return this.resource?.queue?.depth() ?? 0;
  }

  async score(args: LangfuseScoreArgs): Promise<void> {
    if (args.traceId === undefined || args.traceId.length === 0) {
      throw new Error("Langfuse score requires traceId");
    }
    if (this.publicKey === undefined || this.secretKey === undefined) {
      throw new Error("Langfuse score requires publicKey and secretKey");
    }
    assertScoreValue(args.value, args.dataType);
    const resource = await this.resources();
    if (resource.queue !== null) {
      resource.queue.enqueue(args);
      return;
    }
    await this.sendScore(args);
  }

  private resources(): Promise<LangfuseResources> {
    this.assertOpen();
    if (this.resource !== undefined) return Promise.resolve(this.resource);
    this.initialization ??= this.createResources()
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

  private async createResources(): Promise<LangfuseResources> {
    const resolvedConfig = this[langfuseResolvedConfigSymbol];
    const processorOptions: ConstructorParameters<typeof LangfuseSpanProcessor>[0] = {
      baseUrl: this.baseUrl,
    };
    if (this.publicKey !== undefined) processorOptions.publicKey = this.publicKey;
    if (this.secretKey !== undefined) processorOptions.secretKey = this.secretKey;
    if (resolvedConfig.environment !== undefined) {
      processorOptions.environment = resolvedConfig.environment;
    }
    if (resolvedConfig.release !== undefined) processorOptions.release = resolvedConfig.release;
    const processor = new LangfuseSpanProcessor(processorOptions);
    const providerOptions: ConstructorParameters<typeof NodeTracerProvider>[0] = {
      spanProcessors: [processor],
    };
    if (this.serviceName !== undefined) {
      providerOptions.resource = resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: this.serviceName,
      });
    }
    let provider: NodeTracerProvider;
    try {
      provider = new NodeTracerProvider(providerOptions);
    } catch (error) {
      await processor.shutdown().catch(() => undefined);
      throw error;
    }
    try {
      const batchSize = this.options.scores?.batchSize ?? 0;
      const queue =
        batchSize > 0 && this.publicKey !== undefined && this.secretKey !== undefined
          ? new ScoreQueue({
              baseUrl: this.baseUrl,
              publicKey: this.publicKey,
              secretKey: this.secretKey,
              timeoutMs: this.timeoutMs,
              batchSize,
              flushIntervalMs: this.options.scores?.flushIntervalMs ?? 250,
              maxAttempts: scoreMaxAttempts(this.options.scores?.retries),
            })
          : null;
      return {
        processor,
        provider,
        observations: new LangfuseObservationFactory(
          provider.getTracer("@anvia/langfuse", "1.0.0"),
        ),
        queue,
      };
    } catch (error) {
      await provider.shutdown().catch(() => undefined);
      throw error;
    }
  }

  private async closeResources(): Promise<void> {
    this.closed = true;
    const pending =
      this.resource === undefined ? this.initialization : Promise.resolve(this.resource);
    if (pending === undefined) return;
    let resource: LangfuseResources;
    try {
      resource = await pending;
    } catch {
      return;
    }
    const settled = await Promise.allSettled([
      resource.queue?.shutdown() ?? Promise.resolve(),
      resource.provider.shutdown(),
    ]);
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to close LangfuseClient.");
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("LangfuseClient is closed.");
  }

  private async sendScore(args: LangfuseScoreArgs): Promise<void> {
    const body = buildScoreBody(args);
    const response = await fetch(`${this.baseUrl}/api/public/scores`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Langfuse score failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
  }
}

class LangfuseAgentObserver implements AgentObserver {
  constructor(
    private readonly client: LangfuseClient,
    private readonly capture: LangfuseCapture,
  ) {}

  startRun(args: AgentRunStartArgs): Promise<AgentRunObserver> {
    return this.client.startObservedRun(args, this.capture);
  }
}

function resolveLangfuseCapture(options: LangfuseObserverOptions): LangfuseCapture {
  return {
    redactor:
      options.redactInputs !== undefined || options.redactOutputs !== undefined
        ? createPiiRedactor(options.redaction)
        : undefined,
    redactInputs: options.redactInputs,
    redactOutputs: options.redactOutputs,
    captureMode: options.captureMode ?? "safe",
    captureMaxBytes: validateCaptureMaxBytes(options.captureMaxBytes),
  };
}

function captureInput<T>(value: T, capture: LangfuseCapture): unknown {
  const redacted =
    capture.redactor === undefined || capture.redactInputs === undefined
      ? value
      : applyRedaction(capture.redactor, value, capture.redactInputs);
  return sanitizeTraceValue(redacted, capture.captureMaxBytes);
}

function scoreMaxAttempts(retries: { maxAttempts: number } | undefined): number {
  if (retries === undefined) return 3;
  if (!Number.isSafeInteger(retries.maxAttempts) || retries.maxAttempts < 1) {
    throw new TypeError("Langfuse score retries.maxAttempts must be a positive integer.");
  }
  return retries.maxAttempts;
}

function assertScoreValue(value: number | string, dataType: LangfuseScoreArgs["dataType"]): void {
  if (dataType === "NUMERIC") {
    if (typeof value !== "number") {
      throw new TypeError(`Langfuse score dataType=NUMERIC requires a number value`);
    }
    return;
  }
  if (dataType === "CATEGORICAL") {
    if (typeof value !== "string") {
      throw new TypeError(`Langfuse score dataType=CATEGORICAL requires a string value`);
    }
    return;
  }
  if (dataType === "BOOLEAN") {
    if (value !== 0 && value !== 1) {
      throw new TypeError(`Langfuse score dataType=BOOLEAN requires value 0 or 1`);
    }
    return;
  }
}

function buildScoreBody(score: LangfuseScoreArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    traceId: score.traceId,
    name: score.name,
    value: score.value,
  };
  if (score.observationId !== undefined) body.observationId = score.observationId;
  if (score.dataType !== undefined) body.dataType = score.dataType;
  if (score.comment !== undefined) body.comment = score.comment;
  if (score.metadata !== undefined) body.metadata = score.metadata;
  const configId = score.configId ?? score.scoreConfigId;
  if (configId !== undefined) body.configId = configId;
  if (score.environment !== undefined) body.environment = score.environment;
  if (score.timestamp !== undefined) {
    body.timestamp =
      score.timestamp instanceof Date ? score.timestamp.toISOString() : score.timestamp;
  }
  return body;
}

function applyTraceAttributes(
  root: LangfuseAgent,
  args: AgentRunStartArgs,
  capturedMetadata: unknown,
): void {
  const traceName = args.trace?.name ?? args.agentName;
  if (traceName !== undefined) {
    root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, traceName);
  }
  if (args.trace?.userId !== undefined) {
    root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_USER_ID, args.trace.userId);
  }
  if (args.trace?.sessionId !== undefined) {
    root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_SESSION_ID, args.trace.sessionId);
  }
  if (args.trace?.tags !== undefined) {
    root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, [...args.trace.tags]);
  }
  for (const [key, value] of Object.entries(
    isRecord(capturedMetadata) ? capturedMetadata : { value: capturedMetadata },
  )) {
    const serialized = serializeMetadataValue(value);
    if (serialized === undefined) {
      continue;
    }
    root.otelSpan.setAttribute(`${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`, serialized);
  }
  const promptRef = resolvePromptRef(args);
  if (promptRef !== undefined) {
    root.otelSpan.setAttribute(
      `${LangfuseOtelSpanAttributes.TRACE_METADATA}.promptName`,
      promptRef.name,
    );
    if (promptRef.version !== undefined) {
      root.otelSpan.setAttribute(
        `${LangfuseOtelSpanAttributes.TRACE_METADATA}.promptVersion`,
        String(promptRef.version),
      );
    }
  }
}

function applyRedaction<T>(redactor: PiiRedactor, value: T, mode: LangfuseRedactionMode): T {
  if (mode === "deep") {
    return redactor.redactObject(value);
  }
  if (typeof value === "string") {
    return redactor.redactString(value) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    return redactor.redactObject(value);
  }
  return value;
}

function resolvePromptRef(args: AgentRunStartArgs): AgentRunPromptRef | undefined {
  if (args.promptRef !== undefined) {
    return args.promptRef;
  }
  if (args.trace?.promptRef !== undefined) {
    return args.trace.promptRef;
  }
  const metadata = args.trace?.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  const name = metadata.promptName;
  if (typeof name !== "string" || name.length === 0) {
    return undefined;
  }
  const rawVersion = metadata.promptVersion;
  if (rawVersion === undefined || rawVersion === null) {
    return { name };
  }
  const version =
    typeof rawVersion === "number"
      ? rawVersion
      : typeof rawVersion === "string" && rawVersion.trim().length > 0
        ? Number(rawVersion)
        : undefined;
  if (version === undefined || !Number.isFinite(version)) {
    return { name };
  }
  return { name, version };
}

function promptMetadata(
  ref: AgentRunPromptRef | undefined,
): Record<string, string | number | undefined> {
  if (ref === undefined) {
    return {};
  }
  const metadata: Record<string, string | number | undefined> = {
    promptName: ref.name,
  };
  if (ref.version !== undefined) metadata.promptVersion = ref.version;
  return metadata;
}

function serializeMetadataValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "<failed to serialize>";
  }
}

function asMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function eventStartTime(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

class LangfuseRunObserver implements AgentRunObserver {
  private readonly turnSpans = new Map<number, LangfuseSpan>();
  private readonly promptRef: AgentRunPromptRef | undefined;
  private readonly redactor: PiiRedactor | undefined;
  private readonly redactInputs: LangfuseRedactionMode | undefined;
  private readonly redactOutputs: LangfuseRedactionMode | undefined;
  private readonly captureMode: LangfuseCaptureMode;
  private readonly captureMaxBytes: number;

  constructor(
    private readonly root: LangfuseAgent,
    private readonly observations: LangfuseObservationFactory,
    readonly trace: AgentObserverTraceInfo,
    promptRef: AgentRunPromptRef | undefined,
    redaction: {
      redactor: PiiRedactor | undefined;
      redactInputs: LangfuseRedactionMode | undefined;
      redactOutputs: LangfuseRedactionMode | undefined;
      captureMode: LangfuseCaptureMode;
      captureMaxBytes: number;
    },
  ) {
    this.promptRef = promptRef;
    this.redactor = redaction.redactor;
    this.redactInputs = redaction.redactInputs;
    this.redactOutputs = redaction.redactOutputs;
    this.captureMode = redaction.captureMode;
    this.captureMaxBytes = redaction.captureMaxBytes;
  }

  redactInputValue<T>(value: T): unknown {
    const redacted =
      this.redactor === undefined || this.redactInputs === undefined
        ? value
        : applyRedaction(this.redactor, value, this.redactInputs);
    return sanitizeTraceValue(redacted, this.captureMaxBytes);
  }

  redactOutputValue<T>(value: T): unknown {
    const redacted =
      this.redactor === undefined || this.redactOutputs === undefined
        ? value
        : applyRedaction(this.redactor, value, this.redactOutputs);
    return sanitizeTraceValue(redacted, this.captureMaxBytes);
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    this.closeEarlierTurns(args.turn);
    const turn = this.turnSpan(args.turn);
    const safeInput: Record<string, unknown> = {
      instructions: args.request.instructions,
      messages: modelInputMessages(args.request.chatHistory),
    };
    if (this.captureMode === "full") {
      safeInput.documents = args.request.documents;
      safeInput.tools = args.request.tools;
      safeInput.providerTools = args.request.providerTools;
      safeInput.outputSchema = args.request.outputSchema;
      safeInput.providerOptions = args.request.providerOptions;
    }
    const metadata: Record<string, unknown> = {
      turn: args.turn,
      documentCount: args.request.documents.length,
      toolNames: args.request.tools.map((tool) => tool.name),
      providerToolNames: args.request.providerTools?.map((tool) => tool.name) ?? [],
      hasOutputSchema: args.request.outputSchema !== undefined,
      providerOptionKeys: isRecord(args.request.providerOptions)
        ? Object.keys(args.request.providerOptions)
        : [],
    };
    if (this.captureMode === "full" && args.providerRequest !== undefined) {
      metadata.providerRequest = args.providerRequest;
    }
    if (args.modelInfo !== undefined) {
      const modelInfo: Record<string, unknown> = {
        provider: args.modelInfo.provider,
        defaultModel: args.modelInfo.defaultModel,
      };
      if (args.modelInfo.capabilities !== undefined) {
        modelInfo.capabilities = args.modelInfo.capabilities;
      }
      metadata.modelInfo = modelInfo;
    }
    Object.assign(metadata, promptMetadata(this.promptRef));
    const generationAttributes: LangfuseGenerationAttributes = {
      input: this.redactInputValue(safeInput),
      model: args.request.model ?? args.modelInfo?.defaultModel ?? "default",
      modelParameters: modelParameters(args.request),
      metadata: asMetadata(this.redactInputValue(metadata)),
    };
    if (this.promptRef?.version !== undefined) {
      generationAttributes.prompt = {
        name: this.promptRef.name,
        version: this.promptRef.version,
        isFallback: false,
      };
    }
    const generation = this.observations.generation(
      `model.turn.${args.turn}`,
      generationAttributes,
      turn,
    );
    return new LangfuseGenerationObserver(generation, this, new Date());
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const turn = this.turnSpan(args.turn);
    const metadata: Record<string, unknown> = {
      turn: args.turn,
      internalCallId: args.internalCallId,
      toolCallId: args.toolCallId,
    };
    if (this.captureMode === "full") {
      if (args.toolDefinition !== undefined) metadata.toolDefinition = args.toolDefinition;
      if (args.toolMetadata !== undefined) metadata.toolMetadata = args.toolMetadata;
    }
    const tool = this.observations.tool(
      `tool.${args.toolName}`,
      {
        input: this.redactInputValue({
          args: args.args,
          toolCall: args.toolCall,
        }),
        metadata: asMetadata(this.redactInputValue(metadata)),
      },
      turn,
    );
    return new LangfuseToolObserver(tool, this, this.observations);
  }

  end(args: AgentRunEndArgs): void {
    this.closeAllTurns();
    const observedOutput =
      args.status === "completed"
        ? { status: args.status, output: args.output, text: args.text }
        : { status: args.status, stage: args.stage, text: args.text };
    const redactedOutput = this.redactOutputValue(observedOutput);
    const metadata: Record<string, unknown> = {
      status: args.status,
      usage: args.usage,
      messageCount: args.messages.length,
      sources: this.redactOutputValue(args.sources),
      providerToolCalls: this.redactOutputValue(args.providerToolCalls),
    };
    if (this.captureMode === "full") {
      metadata.messages = this.redactTranscript(args.messages);
    }
    this.root
      .update({
        output: redactedOutput,
        metadata,
      })
      .end();
  }

  error(args: AgentRunErrorArgs): void {
    this.closeAllTurns();
    const redactedError = this.redactOutputValue(errorMessage(args.error));
    const metadata: Record<string, unknown> = {
      usage: args.usage,
      messageCount: args.messages.length,
    };
    if (this.captureMode === "full") {
      metadata.messages = this.redactTranscript(args.messages);
    }
    this.root
      .update({
        level: "ERROR",
        statusMessage: typeof redactedError === "string" ? redactedError : "Agent run failed",
        output: {
          error: redactedError,
        },
        metadata,
      })
      .end();
  }

  event(args: AgentRunEventArgs): void {
    const metadata = asMetadata(this.redactOutputValue(args.attributes ?? {}));
    const attributes: LangfuseEventAttributes = { metadata };
    if (args.level !== undefined) {
      attributes.level = args.level;
    }
    const startTime = eventStartTime(args.timestamp);
    this.observations.event(args.name, attributes, this.root, startTime);
  }

  private turnSpan(turn: number): LangfuseSpan {
    const existing = this.turnSpans.get(turn);
    if (existing !== undefined) {
      return existing;
    }

    const span = this.observations.span(
      `turn.${turn}`,
      {
        metadata: { turn },
      },
      this.root,
    );
    this.turnSpans.set(turn, span);
    return span;
  }

  private closeEarlierTurns(currentTurn: number): void {
    for (const [turn, span] of this.turnSpans) {
      if (turn < currentTurn) {
        span.end();
        this.turnSpans.delete(turn);
      }
    }
  }

  private closeAllTurns(): void {
    for (const span of this.turnSpans.values()) {
      span.end();
    }
    this.turnSpans.clear();
  }

  isFullCapture(): boolean {
    return this.captureMode === "full";
  }

  redactTranscript(messages: AgentRunEndArgs["messages"]): unknown {
    const inputRedacted =
      this.redactor === undefined || this.redactInputs === undefined
        ? messages
        : applyRedaction(this.redactor, messages, this.redactInputs);
    const outputRedacted =
      this.redactor === undefined || this.redactOutputs === undefined
        ? inputRedacted
        : applyRedaction(this.redactor, inputRedacted, this.redactOutputs);
    return sanitizeTraceValue(outputRedacted, this.captureMaxBytes);
  }
}

class LangfuseGenerationObserver implements AgentGenerationObserver {
  constructor(
    private readonly generation: LangfuseGeneration,
    private readonly run: LangfuseRunObserver,
    private readonly startedAt: Date,
  ) {}

  update(args: AgentGenerationUpdateArgs): void {
    this.generation.update({
      output: this.run.redactOutputValue({ delta: args.delta }),
    });
  }

  end(args: AgentGenerationEndArgs): void {
    const redactedText = this.run.redactOutputValue(
      textFromObservedAssistantContent(args.response.choice),
    );
    const redactedChoice = this.run.redactOutputValue(args.response.choice);
    const metadata: Record<string, unknown> = { turn: args.turn };
    if (args.firstDeltaMs !== undefined) metadata.firstDeltaMs = args.firstDeltaMs;
    const output: Record<string, unknown> = {
      messageId: args.response.messageId,
      content: redactedChoice,
      text: redactedText,
      sources: this.run.redactOutputValue(args.response.sources),
      providerToolCalls: this.run.redactOutputValue(args.response.providerToolCalls),
    };
    const completionStartTime =
      args.firstDeltaMs === undefined
        ? undefined
        : new Date(this.startedAt.getTime() + args.firstDeltaMs);
    const update: LangfuseGenerationAttributes = {
      output,
      usageDetails: usageDetails(args.response.usage),
      metadata,
    };
    if (completionStartTime !== undefined) {
      update.completionStartTime = completionStartTime;
    }
    this.generation.update(update).end();
  }

  error(args: AgentGenerationErrorArgs): void {
    const redactedError = this.run.redactOutputValue(errorMessage(args.error));
    this.generation
      .update({
        level: "ERROR",
        statusMessage: typeof redactedError === "string" ? redactedError : "Generation failed",
        output: { error: redactedError },
        metadata: { turn: args.turn },
      })
      .end();
  }
}

function textFromObservedAssistantContent(
  content: AgentGenerationEndArgs["response"]["choice"],
): string {
  return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

class LangfuseToolObserver implements AgentToolObserver {
  private readonly childAgents = new Map<string, LangfuseAgent>();
  private readonly childGenerations = new Map<
    string,
    { generation: LangfuseGeneration; startedAt: Date }
  >();
  private readonly childTools: Array<{
    agentId: string;
    toolName: string;
    toolCallId?: string;
    tool: LangfuseTool;
    ended: boolean;
  }> = [];

  constructor(
    private readonly tool: LangfuseTool,
    private readonly run: LangfuseRunObserver,
    private readonly observations: LangfuseObservationFactory,
  ) {}

  streamEvent(args: AgentToolStreamEventArgs): void {
    const wrapper = args.event;
    const child = isRecord(wrapper.event) ? wrapper.event : undefined;
    if (child === undefined) {
      return;
    }

    const agentId = wrapper.agentId;
    const agentName = wrapper.agentName;
    const childTurn = typeof child.turn === "number" ? child.turn : args.turn;
    const agent = this.childAgent(agentId, agentName, args);

    if (child.type === "turn_start") {
      const promptMessage = isRecord(child.prompt) ? (child.prompt as Message) : undefined;
      const historyMessages = Array.isArray(child.history)
        ? (child.history.filter(isRecord) as Message[])
        : [];
      this.observations.event(
        `${agentLabel(agentId, agentName)}.turn.${childTurn}.start`,
        {
          input: this.run.redactInputValue({
            prompt: promptMessage === undefined ? undefined : modelInputMessage(promptMessage),
            history: modelInputMessages(historyMessages),
          }),
          metadata: asMetadata(
            this.run.redactInputValue(childMetadata(args, agentId, agentName, childTurn)),
          ),
        },
        agent,
      );
      return;
    }

    if (child.type === "generation_start" && isRecord(child.request)) {
      const request = child.request;
      const modelInfo = isRecord(child.modelInfo) ? child.modelInfo : undefined;
      const messages = Array.isArray(request.chatHistory)
        ? modelInputMessages(request.chatHistory.filter(isRecord) as Message[])
        : [];
      const input: Record<string, unknown> = {
        instructions: typeof request.instructions === "string" ? request.instructions : undefined,
        messages,
      };
      if (this.run.isFullCapture()) {
        input.documents = request.documents;
        input.tools = request.tools;
        input.providerTools = request.providerTools;
        input.outputSchema = request.outputSchema;
        input.providerOptions = request.providerOptions;
      }
      const toolNames = Array.isArray(request.tools)
        ? request.tools
            .filter(isRecord)
            .map((tool) => tool.name)
            .filter((name): name is string => typeof name === "string")
        : [];
      const providerToolNames = Array.isArray(request.providerTools)
        ? request.providerTools
            .filter(isRecord)
            .map((tool) => tool.name)
            .filter((name): name is string => typeof name === "string")
        : [];
      const generation = this.observations.generation(
        `${agentLabel(agentId, agentName)}.model.turn.${childTurn}`,
        {
          input: this.run.redactInputValue(input),
          model:
            typeof request.model === "string"
              ? request.model
              : typeof modelInfo?.defaultModel === "string"
                ? modelInfo.defaultModel
                : "default",
          modelParameters: modelParameters(request as AgentGenerationStartArgs["request"]),
          metadata: asMetadata(
            this.run.redactInputValue({
              ...childMetadata(args, agentId, agentName, childTurn),
              documentCount: Array.isArray(request.documents) ? request.documents.length : 0,
              toolNames,
              providerToolNames,
              hasOutputSchema: request.outputSchema !== undefined,
              modelInfo,
            }),
          ),
        },
        agent,
      );
      this.childGenerations.set(generationKey(agentId, childTurn), {
        generation,
        startedAt: new Date(),
      });
      return;
    }

    if (child.type === "turn_end") {
      const childGeneration = this.childGenerations.get(generationKey(agentId, childTurn));
      if (childGeneration !== undefined) {
        const update: Parameters<LangfuseGeneration["update"]>[0] = {
          output: this.run.redactOutputValue(child.response),
          metadata: asMetadata(
            this.run.redactOutputValue(childMetadata(args, agentId, agentName, childTurn)),
          ),
        };
        if (isRecord(child.response) && isRecord(child.response.usage)) {
          update.usageDetails = usageDetailsFromRecord(child.response.usage);
        }
        if (typeof child.firstDeltaMs === "number") {
          update.completionStartTime = new Date(
            childGeneration.startedAt.getTime() + child.firstDeltaMs,
          );
        }
        childGeneration.generation.update(update).end();
        this.childGenerations.delete(generationKey(agentId, childTurn));
      }
      return;
    }

    if (
      child.type === "text_delta" ||
      child.type === "reasoning_delta" ||
      child.type === "tool_call_delta"
    ) {
      const childGeneration = this.childGenerations.get(generationKey(agentId, childTurn));
      childGeneration?.generation.update({
        output: this.run.redactOutputValue({ delta: child }),
      });
      return;
    }

    if (child.type === "source" || child.type === "provider_tool_call") {
      const childGeneration = this.childGenerations.get(generationKey(agentId, childTurn));
      const parent = childGeneration?.generation ?? agent;
      this.observations.event(
        `${agentLabel(agentId, agentName)}.${child.type}`,
        {
          output: this.run.redactOutputValue(
            child.type === "source" ? child.source : child.toolCall,
          ),
          metadata: asMetadata(
            this.run.redactOutputValue(childMetadata(args, agentId, agentName, childTurn)),
          ),
        },
        parent,
      );
      return;
    }

    if (child.type === "guardrail_decision") {
      this.observations
        .guardrail(
          `${agentLabel(agentId, agentName)}.guardrail`,
          {
            output: this.run.redactOutputValue(child.decision),
            metadata: asMetadata(
              this.run.redactOutputValue(childMetadata(args, agentId, agentName, childTurn)),
            ),
          },
          agent,
        )
        .end();
      return;
    }

    if (child.type === "tool_call" && isRecord(child.toolCall)) {
      const childGeneration = this.childGenerations.get(generationKey(agentId, childTurn));
      childGeneration?.generation.update({
        output: this.run.redactOutputValue({ toolCall: child.toolCall }),
      });
      const toolCall = child.toolCall;
      const toolName = typeof toolCall.toolName === "string" ? toolCall.toolName : "tool";
      const toolCallId =
        typeof toolCall.toolCallId === "string"
          ? toolCall.toolCallId
          : typeof toolCall.callId === "string"
            ? toolCall.callId
            : undefined;
      const childTool = this.observations.tool(
        `${agentLabel(agentId, agentName)}.${toolName}`,
        {
          input: this.run.redactInputValue({
            args: toolCall.input,
            toolCall,
          }),
          metadata: asMetadata(
            this.run.redactInputValue({
              ...childMetadata(args, agentId, agentName, childTurn),
              toolName,
              toolCallId,
            }),
          ),
        },
        agent,
      );
      const childToolRecord: (typeof this.childTools)[number] = {
        agentId,
        toolName,
        tool: childTool,
        ended: false,
      };
      if (toolCallId !== undefined) childToolRecord.toolCallId = toolCallId;
      this.childTools.push(childToolRecord);
      return;
    }

    if (child.type === "tool_result") {
      const toolName = typeof child.toolName === "string" ? child.toolName : "tool";
      const toolCallId = typeof child.toolCallId === "string" ? child.toolCallId : undefined;
      const childTool = this.findChildTool(agentId, toolName, toolCallId);
      if (childTool !== undefined) {
        childTool.ended = true;
        childTool.tool
          .update({
            output: this.run.redactOutputValue(
              typeof child.result === "string" ? child.result : child,
            ),
            metadata: asMetadata(
              this.run.redactInputValue({
                ...childMetadata(args, agentId, agentName, childTurn),
                toolName,
                toolCallId,
                internalCallId:
                  typeof child.internalCallId === "string" ? child.internalCallId : undefined,
                args: typeof child.args === "string" ? child.args : undefined,
              }),
            ),
          })
          .end();
      }
      return;
    }

    if (child.type === "final") {
      const result = isRecord(child.result) ? child.result : {};
      const update: Parameters<LangfuseAgent["update"]>[0] = {
        output: this.run.redactOutputValue({
          status: result.status,
          output: result.output,
          text: result.text,
        }),
      };
      const metadata: Record<string, unknown> = {};
      if (isRecord(result.usage)) metadata.usage = result.usage;
      if (this.run.isFullCapture() && Array.isArray(result.messages)) {
        metadata.messages = this.run.redactTranscript(result.messages as Message[]);
      }
      if (Object.keys(metadata).length > 0) update.metadata = metadata;
      agent.update(update).end();
      this.childAgents.delete(agentId);
      return;
    }

    if (child.type === "error") {
      const redactedError = this.run.redactOutputValue(errorMessage(child.error));
      const childGeneration = this.childGenerations.get(generationKey(agentId, childTurn));
      childGeneration?.generation
        .update({
          level: "ERROR",
          statusMessage: typeof redactedError === "string" ? redactedError : "Generation failed",
          output: { error: redactedError },
        })
        .end();
      this.childGenerations.delete(generationKey(agentId, childTurn));
      const update: Parameters<LangfuseAgent["update"]>[0] = {
        level: "ERROR",
        statusMessage: typeof redactedError === "string" ? redactedError : "Child agent failed",
        output: { error: redactedError },
      };
      if (isRecord(child.usage)) update.metadata = { usage: child.usage };
      agent.update(update).end();
      this.childAgents.delete(agentId);
    }
  }

  end(args: AgentToolEndArgs): void {
    this.endOpenChildren();
    const redactedResult = this.run.redactOutputValue(args.result);
    const redactedStructured = this.run.redactOutputValue(args.structuredResult);
    const metadata: Record<string, unknown> = {
      turn: args.turn,
      internalCallId: args.internalCallId,
      toolCallId: args.toolCallId,
      skipped: args.skipped,
    };
    if (redactedStructured !== undefined) metadata.structuredResult = redactedStructured;
    const attributes: Parameters<LangfuseTool["update"]>[0] = {
      output: redactedResult,
      metadata,
      level: args.skipped ? "WARNING" : "DEFAULT",
    };
    if (args.skipped) {
      attributes.statusMessage = "Tool call skipped by hook";
    }
    this.tool.update(attributes).end();
  }

  error(args: AgentToolErrorArgs): void {
    this.endOpenChildren();
    const redactedError = this.run.redactOutputValue(errorMessage(args.error));
    this.tool
      .update({
        level: "ERROR",
        statusMessage: typeof redactedError === "string" ? redactedError : "Tool failed",
        output: { error: redactedError },
        metadata: {
          turn: args.turn,
          internalCallId: args.internalCallId,
          toolCallId: args.toolCallId,
        },
      })
      .end();
  }

  private childAgent(
    agentId: string,
    agentName: string | undefined,
    args: AgentToolStartArgs,
  ): LangfuseAgent {
    const existing = this.childAgents.get(agentId);
    if (existing !== undefined) {
      return existing;
    }
    const agent = this.observations.agent(
      `${agentLabel(agentId, agentName)}.run`,
      {
        metadata: asMetadata(
          this.run.redactInputValue(childMetadata(args, agentId, agentName, args.turn)),
        ),
      },
      this.tool,
    );
    this.childAgents.set(agentId, agent);
    return agent;
  }

  private findChildTool(
    agentId: string,
    toolName: string,
    toolCallId: string | undefined,
  ): (typeof this.childTools)[number] | undefined {
    for (let index = this.childTools.length - 1; index >= 0; index -= 1) {
      const childTool = this.childTools[index];
      if (
        childTool === undefined ||
        childTool.ended ||
        childTool.agentId !== agentId ||
        childTool.toolName !== toolName
      ) {
        continue;
      }
      if (toolCallId === undefined || childTool.toolCallId === toolCallId) {
        return childTool;
      }
    }
    return undefined;
  }

  private endOpenChildren(): void {
    for (const generation of this.childGenerations.values()) {
      generation.generation.end();
    }
    this.childGenerations.clear();
    for (const tool of this.childTools) {
      if (!tool.ended) {
        tool.tool.end();
        tool.ended = true;
      }
    }
    for (const agent of this.childAgents.values()) {
      agent.end();
    }
    this.childAgents.clear();
  }
}
