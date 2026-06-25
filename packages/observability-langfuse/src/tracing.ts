import { textFromAssistantContent } from "@anvia/core/completion";
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
  type LangfuseGeneration,
  LangfuseOtelSpanAttributes,
  type LangfuseSpan,
  type LangfuseTool,
  startObservation,
} from "@langfuse/tracing";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
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
  modelParameters,
  usageDetails,
  usageDetailsFromRecord,
} from "./helpers.js";
import { createPiiRedactor, type PiiRedactor } from "./redaction.js";
import { ScoreQueue } from "./scoring.js";
import type {
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
    this.redactor =
      options.redactInputs !== undefined || options.redactOutputs !== undefined
        ? createPiiRedactor(options.redaction)
        : undefined;
  }

  async startRun(args: AgentRunStartArgs): Promise<AgentRunObserver> {
    const traceId = args.trace?.traceId;
    const redactedInput = this.maybeRedactInput({
      prompt: args.prompt,
      history: args.history,
    });
    const rootAttributes: Parameters<typeof startObservation>[1] = {
      input: redactedInput,
      metadata: {
        ...(this.serviceName !== undefined ? { serviceName: this.serviceName } : {}),
        agentName: args.agentName,
        agentDescription: args.agentDescription,
        maxTurns: args.maxTurns,
        ...(args.trace?.metadata ?? {}),
      },
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
    applyTraceAttributes(root, args);

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

  private maybeRedactInput<T>(value: T): T {
    if (this.redactor === undefined || this.redactInputs === undefined) return value;
    return applyRedaction(this.redactor, value, this.redactInputs);
  }

  private maybeRedactOutput<T>(value: T): T {
    if (this.redactor === undefined || this.redactOutputs === undefined) return value;
    return applyRedaction(this.redactor, value, this.redactOutputs);
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

function applyTraceAttributes(root: LangfuseAgent, args: AgentRunStartArgs): void {
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
  for (const [key, value] of Object.entries(args.trace?.metadata ?? {})) {
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
  if (Array.isArray(value)) {
    return redactor.redactMessages(value as never) as unknown as T;
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
  return {
    promptName: ref.name,
    ...(ref.version === undefined ? {} : { promptVersion: ref.version }),
  };
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

  constructor(
    private readonly root: LangfuseAgent,
    readonly trace: AgentTraceInfo,
    promptRef: AgentRunPromptRef | undefined,
    redaction: {
      redactor: PiiRedactor | undefined;
      redactInputs: LangfuseRedactionMode | undefined;
      redactOutputs: LangfuseRedactionMode | undefined;
    },
  ) {
    this.handle = this.buildHandle();
    this.promptRef = promptRef;
    this.redactor = redaction.redactor;
    this.redactInputs = redaction.redactInputs;
    this.redactOutputs = redaction.redactOutputs;
  }

  redactInputValue<T>(value: T): T {
    if (this.redactor === undefined || this.redactInputs === undefined) return value;
    return applyRedaction(this.redactor, value, this.redactInputs);
  }

  redactOutputValue<T>(value: T): T {
    if (this.redactor === undefined || this.redactOutputs === undefined) return value;
    return applyRedaction(this.redactor, value, this.redactOutputs);
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    this.closeEarlierTurns(args.turn);
    const turn = this.turnSpan(args.turn);
    const redactedChatHistory = this.redactInputValue(args.request.chatHistory);
    const generation = turn.startObservation(
      `model.turn.${args.turn}`,
      {
        input: redactedChatHistory,
        model: args.request.model ?? "default",
        modelParameters: modelParameters(args.request),
        metadata: {
          turn: args.turn,
          toolCount: args.request.tools.length,
          hasOutputSchema: args.request.outputSchema !== undefined,
          ...(args.providerRequest !== undefined ? { providerRequest: args.providerRequest } : {}),
          ...(args.modelInfo !== undefined
            ? {
                modelInfo: {
                  provider: args.modelInfo.provider,
                  defaultModel: args.modelInfo.defaultModel,
                  ...(args.modelInfo.capabilities !== undefined
                    ? { capabilities: args.modelInfo.capabilities }
                    : {}),
                },
              }
            : {}),
          ...promptMetadata(this.promptRef),
        },
      },
      { asType: "generation" },
    );
    return new LangfuseGenerationObserver(generation, this);
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const turn = this.turnSpan(args.turn);
    const redactedArgs = this.redactInputValue(args.args);
    const tool = turn.startObservation(
      `tool.${args.toolName}`,
      {
        input: {
          args: redactedArgs,
          toolCall: args.toolCall,
        },
        metadata: {
          turn: args.turn,
          internalCallId: args.internalCallId,
          toolCallId: args.toolCallId,
          ...(args.toolDefinition !== undefined ? { toolDefinition: args.toolDefinition } : {}),
          ...(args.toolMetadata !== undefined ? { toolMetadata: args.toolMetadata } : {}),
        },
      },
      { asType: "tool" },
    );
    return new LangfuseToolObserver(tool, this);
  }

  end(args: AgentRunEndArgs): void {
    this.closeAllTurns();
    const redactedOutput = this.redactOutputValue(args.output);
    this.root
      .update({
        output: redactedOutput,
        metadata: {
          usage: args.usage,
          messages: args.messages,
        },
      })
      .end();
    this.clearCurrentHandle?.();
  }

  error(args: AgentRunErrorArgs): void {
    this.closeAllTurns();
    this.root
      .update({
        level: "ERROR",
        statusMessage: errorMessage(args.error),
        output: {
          error: errorMessage(args.error),
        },
        metadata: {
          usage: args.usage,
          messages: args.messages,
        },
      })
      .end();
    this.clearCurrentHandle?.();
  }

  event(args: AgentRunEventArgs): void {
    const metadata: Record<string, unknown> = { ...(args.attributes ?? {}) };
    this.root.startObservation(args.name, { metadata }, { asType: "event" }).end();
  }

  getHandle(): LangfuseTraceHandle {
    return this.handle;
  }

  private buildHandle(): LangfuseTraceHandle {
    return {
      traceId: this.trace.traceId ?? "",
      observationId: this.trace.observationId ?? "",
      addAttributes: (attributes) => {
        this.root.update({ metadata: attributes });
        this.setCurrentHandle?.(this.handle);
      },
      addEvent: (name, attributes) => {
        const metadata: Record<string, unknown> = { ...(attributes ?? {}) };
        this.root.startObservation(name, { metadata }, { asType: "event" }).end();
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
}

class LangfuseGenerationObserver implements AgentGenerationObserver {
  constructor(
    private readonly generation: LangfuseGeneration,
    private readonly run: LangfuseRunObserver,
  ) {}

  update(args: AgentGenerationUpdateArgs): void {
    this.generation.update({
      output: { delta: args.delta },
    });
  }

  end(args: AgentGenerationEndArgs): void {
    const redactedText = this.run.redactOutputValue(textFromAssistantContent(args.response.choice));
    const redactedChoice = this.run.redactOutputValue(args.response.choice);
    this.generation
      .update({
        output: {
          messageId: args.response.messageId,
          content: redactedChoice,
          text: redactedText,
        },
        usageDetails: usageDetails(args.response.usage),
        metadata: {
          turn: args.turn,
          ...(args.firstDeltaMs !== undefined ? { firstDeltaMs: args.firstDeltaMs } : {}),
        },
      })
      .end();
  }

  error(args: AgentGenerationErrorArgs): void {
    this.generation
      .update({
        level: "ERROR",
        statusMessage: errorMessage(args.error),
        output: { error: errorMessage(args.error) },
        metadata: { turn: args.turn },
      })
      .end();
  }
}

class LangfuseToolObserver implements AgentToolObserver {
  private readonly childAgents = new Map<string, LangfuseAgent>();
  private readonly childGenerations = new Map<string, LangfuseGeneration>();
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
      const generation = agent.startObservation(
        `${agentLabel(agentId, agentName)}.model.turn.${childTurn}`,
        {
          input: {
            prompt: child.prompt,
            history: child.history,
          },
          metadata: childMetadata(args, agentId, agentName, childTurn),
        },
        { asType: "generation" },
      );
      this.childGenerations.set(generationKey(agentId, childTurn), generation);
      return;
    }

    if (child.type === "turn_end") {
      const generation = this.childGenerations.get(generationKey(agentId, childTurn));
      if (generation !== undefined) {
        generation
          .update({
            output: child.response,
            ...(isRecord(child.response) && isRecord(child.response.usage)
              ? { usageDetails: usageDetailsFromRecord(child.response.usage) }
              : {}),
            metadata: childMetadata(args, agentId, agentName, childTurn),
          })
          .end();
        this.childGenerations.delete(generationKey(agentId, childTurn));
      }
      return;
    }

    if (child.type === "tool_call" && isRecord(child.toolCall)) {
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
          input: {
            args: toolCallFunction?.arguments ?? {},
            toolCall,
          },
          metadata: {
            ...childMetadata(args, agentId, agentName, childTurn),
            toolName,
            toolCallId,
          },
        },
        { asType: "tool" },
      );
      this.childTools.push({
        agentId,
        toolName,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        tool: childTool,
        ended: false,
      });
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
            output: typeof child.result === "string" ? child.result : child,
            metadata: {
              ...childMetadata(args, agentId, agentName, childTurn),
              toolName,
              toolCallId,
              internalCallId:
                typeof child.internalCallId === "string" ? child.internalCallId : undefined,
              args: typeof child.args === "string" ? child.args : undefined,
            },
          })
          .end();
      }
      return;
    }

    if (child.type === "final") {
      agent
        .update({
          output: child.output,
          ...(isRecord(child.usage) ? { metadata: { usage: child.usage } } : {}),
        })
        .end();
      this.childAgents.delete(agentId);
      return;
    }

    if (child.type === "error") {
      agent
        .update({
          level: "ERROR",
          statusMessage: errorMessage(child.error),
          output: { error: errorMessage(child.error) },
        })
        .end();
      this.childAgents.delete(agentId);
    }
  }

  end(args: AgentToolEndArgs): void {
    this.endOpenChildren();
    const redactedResult = this.run.redactOutputValue(args.result);
    const redactedStructured = this.run.redactOutputValue(args.structuredResult);
    const attributes: Parameters<LangfuseTool["update"]>[0] = {
      output: redactedResult,
      metadata: {
        turn: args.turn,
        internalCallId: args.internalCallId,
        toolCallId: args.toolCallId,
        skipped: args.skipped,
        ...(redactedStructured !== undefined ? { structuredResult: redactedStructured } : {}),
      },
      level: args.skipped ? "WARNING" : "DEFAULT",
    };
    if (args.skipped) {
      attributes.statusMessage = "Tool call skipped by hook";
    }
    this.tool.update(attributes).end();
  }

  error(args: AgentToolErrorArgs): void {
    this.endOpenChildren();
    this.tool
      .update({
        level: "ERROR",
        statusMessage: errorMessage(args.error),
        output: { error: errorMessage(args.error) },
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
        metadata: childMetadata(args, agentId, agentName, args.turn),
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
      generation.end();
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
