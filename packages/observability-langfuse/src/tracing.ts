import { type Message, textFromAssistantContent } from "@anvia/core/completion";
import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentGenerationUpdateArgs,
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
  AgentTraceInfo,
} from "@anvia/core/observability";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  type LangfuseAgent,
  type LangfuseEventAttributes,
  type LangfuseGeneration,
  type LangfuseGenerationAttributes,
  LangfuseOtelSpanAttributes,
  type LangfuseSpan,
  type LangfuseTool,
  startObservation,
} from "@langfuse/tracing";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { sanitizeTraceValue, validateCaptureMaxBytes } from "./capture.js";
import {
  type LangfuseResolvedConfig,
  langfuseResolvedConfigSymbol,
  resolveLangfuseConfig,
} from "./config.js";
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
import { createPiiRedactor, type PiiRedactor } from "./redaction.js";
import { ScoreQueue } from "./scoring.js";
import type {
  LangfuseCaptureMode,
  LangfuseRedactionMode,
  LangfuseScoreArgs,
  LangfuseTraceHandle,
  LangfuseTracing,
  LangfuseTracingOptions,
} from "./types.js";

export const langfuse = {
  create(options: LangfuseTracingOptions = {}): LangfuseTracing {
    return new LangfuseAgentObserver(options);
  },
};

class LangfuseAgentObserver implements LangfuseTracing {
  private readonly processor: LangfuseSpanProcessor;
  private readonly sdk: NodeSDK;
  readonly [langfuseResolvedConfigSymbol]: LangfuseResolvedConfig;
  private readonly publicKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;
  private readonly serviceName: string | undefined;
  private readonly timeoutMs: number;
  private readonly queue: ScoreQueue | null;
  private currentHandle: LangfuseTraceHandle | undefined;
  private readonly redactor: PiiRedactor | undefined;
  private readonly redactInputs: LangfuseRedactionMode | undefined;
  private readonly redactOutputs: LangfuseRedactionMode | undefined;
  private readonly captureMode: LangfuseCaptureMode;
  private readonly captureMaxBytes: number;

  constructor(options: LangfuseTracingOptions) {
    const resolvedConfig = resolveLangfuseConfig(options);
    this[langfuseResolvedConfigSymbol] = resolvedConfig;
    this.publicKey = resolvedConfig.publicKey;
    this.secretKey = resolvedConfig.secretKey;
    this.baseUrl = resolvedConfig.baseUrl;
    this.serviceName = resolvedConfig.serviceName;
    this.timeoutMs = resolvedConfig.timeoutMs;
    const processorOptions: ConstructorParameters<typeof LangfuseSpanProcessor>[0] = {
      baseUrl: this.baseUrl,
    };
    if (this.publicKey !== undefined) processorOptions.publicKey = this.publicKey;
    if (this.secretKey !== undefined) processorOptions.secretKey = this.secretKey;
    if (resolvedConfig.environment !== undefined) {
      processorOptions.environment = resolvedConfig.environment;
    }
    if (resolvedConfig.release !== undefined) processorOptions.release = resolvedConfig.release;
    this.processor = new LangfuseSpanProcessor(processorOptions);
    const sdkOptions: ConstructorParameters<typeof NodeSDK>[0] = {
      spanProcessors: [this.processor],
    };
    if (this.serviceName !== undefined) {
      sdkOptions.resource = resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: this.serviceName,
      });
    }
    this.sdk = new NodeSDK(sdkOptions);
    this.sdk.start();
    const batchSize = options.scoreBatchSize ?? 0;
    this.queue =
      batchSize > 0 && this.publicKey !== undefined && this.secretKey !== undefined
        ? new ScoreQueue({
            baseUrl: this.baseUrl,
            publicKey: this.publicKey,
            secretKey: this.secretKey,
            timeoutMs: this.timeoutMs,
            batchSize,
            flushIntervalMs: options.scoreFlushIntervalMs ?? 250,
            maxRetries: options.scoreMaxRetries ?? 3,
          })
        : null;
    this.redactInputs = options.redactInputs;
    this.redactOutputs = options.redactOutputs;
    this.captureMode = options.captureMode ?? "safe";
    this.captureMaxBytes = validateCaptureMaxBytes(options.captureMaxBytes);
    this.redactor =
      options.redactInputs !== undefined || options.redactOutputs !== undefined
        ? createPiiRedactor(options.redaction)
        : undefined;
  }

  async startRun(args: AgentRunStartArgs): Promise<AgentRunObserver> {
    const traceId = args.trace?.traceId;
    const capturedInput = this.captureInput({
      instructions: args.instructions,
      prompt: args.prompt,
      history: args.history,
    });
    const capturedTraceMetadata = this.captureInput(args.trace?.metadata ?? {});
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
    const rootAttributes: Parameters<typeof startObservation>[1] = {
      input: capturedInput,
      metadata,
    };
    if (args.trace?.version !== undefined) {
      rootAttributes.version = args.trace.version;
    }

    const root = startObservation(
      args.agentName ?? "agent.run",
      rootAttributes,
      traceId === undefined
        ? { asType: "agent" }
        : {
            asType: "agent",
            parentSpanContext: {
              traceId,
              spanId: "0000000000000001",
              traceFlags: 1,
            },
          },
    );
    applyTraceAttributes(root, args, capturedTraceMetadata);

    const promptRef = resolvePromptRef(args);
    const runObserver = new LangfuseRunObserver(
      root,
      {
        traceId: root.traceId,
        observationId: root.id,
      },
      promptRef,
      {
        redactor: this.redactor,
        redactInputs: this.redactInputs,
        redactOutputs: this.redactOutputs,
        captureMode: this.captureMode,
        captureMaxBytes: this.captureMaxBytes,
      },
    );
    this.currentHandle = runObserver.getHandle();
    runObserver.setCurrentHandle = (handle) => {
      this.currentHandle = handle;
    };
    runObserver.clearCurrentHandle = () => {
      if (this.currentHandle === runObserver.getHandle()) {
        this.currentHandle = undefined;
      }
    };
    return runObserver;
  }

  async flush(): Promise<void> {
    await this.queue?.flush();
    await this.processor.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.queue?.shutdown();
    await this.sdk.shutdown();
  }

  async flushScores(): Promise<void> {
    await this.queue?.flush();
  }

  scoreQueueDepth(): number {
    return this.queue?.depth() ?? 0;
  }

  getCurrentTrace(): LangfuseTraceHandle | undefined {
    return this.currentHandle;
  }

  private captureInput<T>(value: T): unknown {
    const redacted =
      this.redactor === undefined || this.redactInputs === undefined
        ? value
        : applyRedaction(this.redactor, value, this.redactInputs);
    return sanitizeTraceValue(redacted, this.captureMaxBytes);
  }

  async score(args: LangfuseScoreArgs): Promise<void> {
    if (args.traceId === undefined || args.traceId.length === 0) {
      throw new Error("Langfuse score requires traceId");
    }
    if (this.publicKey === undefined || this.secretKey === undefined) {
      throw new Error("Langfuse score requires publicKey and secretKey");
    }
    assertScoreValue(args.value, args.dataType);

    if (this.queue !== null) {
      this.queue.enqueue(args);
      return;
    }

    await this.sendScore(args);
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
    root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, args.trace.tags);
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

function eventStartTime(value: Date | string | undefined): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

class LangfuseRunObserver implements AgentRunObserver {
  private readonly turnSpans = new Map<number, LangfuseSpan>();
  // Assigned by LangfuseAgentObserver.startRun so that the run can
  // publish trace-handle updates back to the agent observer.
  setCurrentHandle: ((handle: LangfuseTraceHandle) => void) | undefined;
  clearCurrentHandle: (() => void) | undefined;
  private handle: LangfuseTraceHandle;
  private readonly promptRef: AgentRunPromptRef | undefined;
  private readonly redactor: PiiRedactor | undefined;
  private readonly redactInputs: LangfuseRedactionMode | undefined;
  private readonly redactOutputs: LangfuseRedactionMode | undefined;
  private readonly captureMode: LangfuseCaptureMode;
  private readonly captureMaxBytes: number;

  constructor(
    private readonly root: LangfuseAgent,
    readonly trace: AgentTraceInfo,
    promptRef: AgentRunPromptRef | undefined,
    redaction: {
      redactor: PiiRedactor | undefined;
      redactInputs: LangfuseRedactionMode | undefined;
      redactOutputs: LangfuseRedactionMode | undefined;
      captureMode: LangfuseCaptureMode;
      captureMaxBytes: number;
    },
  ) {
    this.handle = this.buildHandle();
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
      safeInput.additionalParams = args.request.additionalParams;
    }
    const metadata: Record<string, unknown> = {
      turn: args.turn,
      documentCount: args.request.documents.length,
      toolNames: args.request.tools.map((tool) => tool.name),
      providerToolNames: args.request.providerTools?.map((tool) => tool.name) ?? [],
      hasOutputSchema: args.request.outputSchema !== undefined,
      additionalParamKeys: isRecord(args.request.additionalParams)
        ? Object.keys(args.request.additionalParams)
        : [],
    };
    if (this.captureMode === "full" && args.providerRequest !== undefined) {
      metadata.providerRequest = this.redactInputValue(args.providerRequest);
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
    const generation = turn.startObservation(`model.turn.${args.turn}`, generationAttributes, {
      asType: "generation",
    });
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
    const tool = turn.startObservation(
      `tool.${args.toolName}`,
      {
        input: this.redactInputValue({
          args: args.args,
          toolCall: args.toolCall,
        }),
        metadata: asMetadata(this.redactInputValue(metadata)),
      },
      { asType: "tool" },
    );
    return new LangfuseToolObserver(tool, this);
  }

  end(args: AgentRunEndArgs): void {
    this.closeAllTurns();
    const redactedOutput = this.redactOutputValue(args.output);
    const metadata: Record<string, unknown> = {
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
    this.clearCurrentHandle?.();
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
    this.clearCurrentHandle?.();
  }

  event(args: AgentRunEventArgs): void {
    const metadata = asMetadata(this.redactOutputValue(args.attributes ?? {}));
    const attributes: LangfuseEventAttributes = { metadata };
    if (args.level !== undefined) {
      attributes.level = args.level;
    }
    const startTime = eventStartTime(args.timestamp);
    this.root.startObservation(args.name, attributes, {
      asType: "event",
      ...(startTime === undefined ? {} : { startTime }),
    });
  }

  getHandle(): LangfuseTraceHandle {
    return this.handle;
  }

  private buildHandle(): LangfuseTraceHandle {
    return {
      traceId: this.trace.traceId ?? "",
      observationId: this.trace.observationId ?? "",
      addAttributes: (attributes) => {
        this.root.update({ metadata: asMetadata(this.redactOutputValue(attributes)) });
        this.setCurrentHandle?.(this.handle);
      },
      addEvent: (name, attributes) => {
        this.root.startObservation(
          name,
          { metadata: asMetadata(this.redactOutputValue(attributes ?? {})) },
          { asType: "event" },
        );
        this.setCurrentHandle?.(this.handle);
      },
    };
  }

  private turnSpan(turn: number): LangfuseSpan {
    const existing = this.turnSpans.get(turn);
    if (existing !== undefined) {
      return existing;
    }

    const span = this.root.startObservation(
      `turn.${turn}`,
      {
        metadata: { turn },
      },
      { asType: "span" },
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

  redactTranscript(messages: Message[]): unknown {
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
    const redactedText = this.run.redactOutputValue(textFromAssistantContent(args.response.choice));
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
      agent.startObservation(
        `${agentLabel(agentId, agentName)}.turn.${childTurn}.start`,
        {
          input: this.run.redactInputValue({
            prompt: modelInputMessage(child.prompt as Message),
            history: modelInputMessages(child.history as Message[]),
          }),
          metadata: asMetadata(
            this.run.redactInputValue(childMetadata(args, agentId, agentName, childTurn)),
          ),
        },
        { asType: "event" },
      );
      return;
    }

    if (child.type === "generation_start" && isRecord(child.request)) {
      const request = child.request;
      const modelInfo = isRecord(child.modelInfo) ? child.modelInfo : undefined;
      const messages = Array.isArray(request.chatHistory)
        ? modelInputMessages(request.chatHistory as Message[])
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
        input.additionalParams = request.additionalParams;
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
      const generation = agent.startObservation(
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
        { asType: "generation" },
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
      parent.startObservation(
        `${agentLabel(agentId, agentName)}.${child.type}`,
        {
          output: this.run.redactOutputValue(
            child.type === "source" ? child.source : child.toolCall,
          ),
          metadata: asMetadata(
            this.run.redactOutputValue(childMetadata(args, agentId, agentName, childTurn)),
          ),
        },
        { asType: "event" },
      );
      return;
    }

    if (child.type === "guardrail_decision") {
      agent
        .startObservation(
          `${agentLabel(agentId, agentName)}.guardrail`,
          {
            output: this.run.redactOutputValue(child.decision),
            metadata: asMetadata(
              this.run.redactOutputValue(childMetadata(args, agentId, agentName, childTurn)),
            ),
          },
          { asType: "guardrail" },
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
      const toolCallFunction = isRecord(toolCall.function) ? toolCall.function : undefined;
      const toolName = typeof toolCallFunction?.name === "string" ? toolCallFunction.name : "tool";
      const toolCallId =
        typeof toolCall.callId === "string"
          ? toolCall.callId
          : typeof toolCall.id === "string"
            ? toolCall.id
            : undefined;
      const childTool = agent.startObservation(
        `${agentLabel(agentId, agentName)}.${toolName}`,
        {
          input: this.run.redactInputValue({
            args: toolCallFunction?.arguments ?? {},
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
        { asType: "tool" },
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
      const update: Parameters<LangfuseAgent["update"]>[0] = {
        output: this.run.redactOutputValue(child.output),
      };
      const metadata: Record<string, unknown> = {};
      if (isRecord(child.usage)) metadata.usage = child.usage;
      if (this.run.isFullCapture() && Array.isArray(child.messages)) {
        metadata.messages = this.run.redactTranscript(child.messages as Message[]);
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
    const agent = this.tool.startObservation(
      `${agentLabel(agentId, agentName)}.run`,
      {
        metadata: asMetadata(
          this.run.redactInputValue(childMetadata(args, agentId, agentName, args.turn)),
        ),
      },
      { asType: "agent" },
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
