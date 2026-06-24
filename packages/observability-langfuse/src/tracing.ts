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
  agentLabel,
  childMetadata,
  errorMessage,
  generationKey,
  isRecord,
  modelParameters,
  resolveOption,
  usageDetails,
  usageDetailsFromRecord,
} from "./helpers.js";
import { ScoreQueue } from "./scoring.js";
import type {
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
  private readonly publicKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;
  private readonly serviceName: string | undefined;
  private readonly timeoutMs: number;
  private readonly queue: ScoreQueue | null;
  private currentHandle: LangfuseTraceHandle | undefined;

  constructor(options: LangfuseTracingOptions) {
    this.publicKey = resolveOption(options.publicKey, process.env.LANGFUSE_PUBLIC_KEY);
    this.secretKey = resolveOption(options.secretKey, process.env.LANGFUSE_SECRET_KEY);
    this.baseUrl =
      resolveOption(options.baseUrl, process.env.LANGFUSE_BASE_URL) ?? "https://cloud.langfuse.com";
    this.serviceName = resolveOption(options.serviceName, process.env.LANGFUSE_SERVICE_NAME);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const processorOptions: ConstructorParameters<typeof LangfuseSpanProcessor>[0] = {
      baseUrl: this.baseUrl,
    };
    if (this.publicKey !== undefined) processorOptions.publicKey = this.publicKey;
    if (this.secretKey !== undefined) processorOptions.secretKey = this.secretKey;
    const environment = resolveOption(
      options.environment,
      process.env.LANGFUSE_TRACING_ENVIRONMENT,
    );
    if (environment !== undefined) processorOptions.environment = environment;
    const release = resolveOption(options.release, process.env.LANGFUSE_RELEASE);
    if (release !== undefined) processorOptions.release = release;
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
  }

  async startRun(args: AgentRunStartArgs): Promise<AgentRunObserver> {
    const traceId = args.trace?.traceId;
    const rootAttributes: Parameters<typeof startObservation>[1] = {
      input: {
        prompt: args.prompt,
        history: args.history,
      },
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

    const runObserver = new LangfuseRunObserver(root, {
      traceId: root.traceId,
      observationId: root.id,
    });
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

  constructor(
    private readonly root: LangfuseAgent,
    readonly trace: AgentTraceInfo,
  ) {
    this.handle = this.buildHandle();
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    this.closeEarlierTurns(args.turn);
    const turn = this.turnSpan(args.turn);
    const generation = turn.startObservation(
      `model.turn.${args.turn}`,
      {
        input: args.request.chatHistory,
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
        },
      },
      { asType: "generation" },
    );
    return new LangfuseGenerationObserver(generation);
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const turn = this.turnSpan(args.turn);
    const tool = turn.startObservation(
      `tool.${args.toolName}`,
      {
        input: {
          args: args.args,
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
    return new LangfuseToolObserver(tool);
  }

  end(args: AgentRunEndArgs): void {
    this.closeAllTurns();
    this.root
      .update({
        output: args.output,
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
  constructor(private readonly generation: LangfuseGeneration) {}

  update(args: AgentGenerationUpdateArgs): void {
    this.generation.update({
      output: { delta: args.delta },
    });
  }

  end(args: AgentGenerationEndArgs): void {
    this.generation
      .update({
        output: {
          messageId: args.response.messageId,
          content: args.response.choice,
          text: textFromAssistantContent(args.response.choice),
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

  constructor(private readonly tool: LangfuseTool) {}

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
    const attributes: Parameters<LangfuseTool["update"]>[0] = {
      output: args.result,
      metadata: {
        turn: args.turn,
        internalCallId: args.internalCallId,
        toolCallId: args.toolCallId,
        skipped: args.skipped,
        ...(args.structuredResult !== undefined ? { structuredResult: args.structuredResult } : {}),
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
