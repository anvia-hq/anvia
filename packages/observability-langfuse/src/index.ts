import { type JsonValue, textFromAssistantContent } from "@anvia/core/completion";
import type { EvalOutcome, EvalReportArgs, EvalReporter } from "@anvia/core/evals";
import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentObserver,
  AgentRunEndArgs,
  AgentRunErrorArgs,
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
import { NodeSDK } from "@opentelemetry/sdk-node";

export type LangfuseTracingOptions = {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
};

export type LangfuseScoreArgs = {
  traceId?: string | undefined;
  observationId?: string | undefined;
  name: string;
  value: number;
  comment?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
};

export type LangfuseTracing = AgentObserver & {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  score(args: LangfuseScoreArgs): Promise<void>;
};

export type LangfuseEvalReporterOptions = {
  publishInvalid?: boolean | undefined;
  strict?: boolean | undefined;
};

export const langfuse = {
  create(options: LangfuseTracingOptions = {}): LangfuseTracing {
    return new LangfuseAgentObserver(options);
  },
};

export function createLangfuseEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: Pick<LangfuseTracing, "score">,
  options: LangfuseEvalReporterOptions = {},
): EvalReporter<Input, Output, Expected> {
  return {
    async report(args) {
      if (args.outcome.outcome === "invalid" && options.publishInvalid !== true) {
        return;
      }

      const trace = traceFromEvalReport(args);
      if (trace?.traceId === undefined || trace.traceId.length === 0) {
        if (options.strict === true) {
          throw new Error("Langfuse eval reporter requires traceId");
        }
        return;
      }

      await tracing.score({
        traceId: trace.traceId,
        name: args.metric.name,
        value: scoreValue(args.outcome),
        metadata: {
          suiteName: args.suiteName,
          caseId: args.case.id,
          outcome: args.outcome.outcome,
        },
        ...(trace.observationId === undefined ? {} : { observationId: trace.observationId }),
        ...(scoreComment(args.outcome) === undefined
          ? {}
          : { comment: scoreComment(args.outcome) as string }),
      });
    },
  };
}

function scoreValue(outcome: EvalOutcome): number {
  if (outcome.outcome === "invalid") {
    return 0;
  }
  if (typeof outcome.score === "number") {
    return outcome.score;
  }
  if (typeof outcome.score === "boolean") {
    return outcome.score ? 1 : 0;
  }
  if (
    typeof outcome.score === "object" &&
    outcome.score !== null &&
    "score" in outcome.score &&
    typeof (outcome.score as { score?: unknown }).score === "number"
  ) {
    return (outcome.score as { score: number }).score;
  }
  return outcome.outcome === "pass" ? 1 : 0;
}

function scoreComment(outcome: EvalOutcome): string | undefined {
  return outcome.comment ?? (outcome.outcome === "invalid" ? outcome.reason : undefined);
}

function traceFromEvalReport<Input, Output, Expected>(
  args: EvalReportArgs<Input, Output, unknown, Expected>,
): AgentTraceInfo | undefined {
  const outputTrace = traceFromOutput(args.output);
  if (outputTrace !== undefined) {
    return outputTrace;
  }
  const traceId = args.case.metadata?.traceId;
  const observationId = args.case.metadata?.observationId;
  if (typeof traceId !== "string") {
    return undefined;
  }
  return {
    traceId,
    ...(typeof observationId === "string" ? { observationId } : {}),
  };
}

function traceFromOutput(output: unknown): AgentTraceInfo | undefined {
  if (typeof output !== "object" || output === null || !("trace" in output)) {
    return undefined;
  }
  const trace = (output as { trace?: unknown }).trace;
  if (typeof trace !== "object" || trace === null) {
    return undefined;
  }
  const traceId = (trace as { traceId?: unknown }).traceId;
  const observationId = (trace as { observationId?: unknown }).observationId;
  if (typeof traceId !== "string") {
    return undefined;
  }
  return {
    traceId,
    ...(typeof observationId === "string" ? { observationId } : {}),
  };
}

class LangfuseAgentObserver implements LangfuseTracing {
  private readonly processor: LangfuseSpanProcessor;
  private readonly sdk: NodeSDK;
  private readonly publicKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: LangfuseTracingOptions) {
    this.publicKey = emptyToUndefined(options.publicKey);
    this.secretKey = emptyToUndefined(options.secretKey);
    this.baseUrl = emptyToUndefined(options.baseUrl) ?? "https://cloud.langfuse.com";
    const processorOptions: ConstructorParameters<typeof LangfuseSpanProcessor>[0] = {
      baseUrl: this.baseUrl,
    };
    if (this.publicKey !== undefined) processorOptions.publicKey = this.publicKey;
    if (this.secretKey !== undefined) processorOptions.secretKey = this.secretKey;
    const environment = emptyToUndefined(options.environment);
    if (environment !== undefined) processorOptions.environment = environment;
    const release = emptyToUndefined(options.release);
    if (release !== undefined) processorOptions.release = release;
    this.processor = new LangfuseSpanProcessor(processorOptions);
    this.sdk = new NodeSDK({
      spanProcessors: [this.processor],
    });
    this.sdk.start();
  }

  async startRun(args: AgentRunStartArgs): Promise<AgentRunObserver> {
    const traceId = args.trace?.traceId;
    const rootAttributes: Parameters<typeof startObservation>[1] = {
      input: {
        prompt: args.prompt,
        history: args.history,
      },
      metadata: {
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

    return new LangfuseRunObserver(root, {
      traceId: root.traceId,
      observationId: root.id,
    });
  }

  async flush(): Promise<void> {
    await this.processor.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.sdk.shutdown();
  }

  async score(args: LangfuseScoreArgs): Promise<void> {
    if (args.traceId === undefined || args.traceId.length === 0) {
      throw new Error("Langfuse score requires traceId");
    }
    if (this.publicKey === undefined || this.secretKey === undefined) {
      throw new Error("Langfuse score requires publicKey and secretKey");
    }

    const body: Record<string, unknown> = {
      traceId: args.traceId,
      name: args.name,
      value: args.value,
    };
    if (args.observationId !== undefined) body.observationId = args.observationId;
    if (args.comment !== undefined) body.comment = args.comment;
    if (args.metadata !== undefined) body.metadata = args.metadata;

    const response = await fetch(`${this.baseUrl}/api/public/scores`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Langfuse score failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
  }
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

  constructor(
    private readonly root: LangfuseAgent,
    readonly trace: AgentTraceInfo,
  ) {}

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

function modelParameters(
  request: AgentGenerationStartArgs["request"],
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.maxTokens !== undefined) params.maxTokens = request.maxTokens;
  if (request.toolChoice !== undefined) {
    params.toolChoice =
      typeof request.toolChoice === "string" ? request.toolChoice : request.toolChoice.name;
  }
  return params;
}

function usageDetails(usage: AgentGenerationEndArgs["response"]["usage"]): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
}

function usageDetailsFromRecord(usage: Record<string, unknown>): Record<string, number> {
  return {
    inputTokens: numberValue(usage.inputTokens) ?? 0,
    outputTokens: numberValue(usage.outputTokens) ?? 0,
    totalTokens:
      numberValue(usage.totalTokens) ??
      (numberValue(usage.inputTokens) ?? 0) + (numberValue(usage.outputTokens) ?? 0),
  };
}

function childMetadata(
  args: AgentToolStartArgs,
  agentId: string,
  agentName: string | undefined,
  childTurn: number,
): Record<string, unknown> {
  return {
    source: "agent_tool_event",
    childAgentId: agentId,
    childAgentName: agentName,
    childTurn,
    parentToolName: args.toolName,
    parentInternalCallId: args.internalCallId,
    parentToolCallId: args.toolCallId,
  };
}

function generationKey(agentId: string, turn: number): string {
  return `${agentId}:${turn}`;
}

function agentLabel(agentId: string, agentName: string | undefined): string {
  return (agentName ?? agentId).replaceAll(/\s+/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
