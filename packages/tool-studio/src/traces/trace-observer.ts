import type { JsonObject, JsonValue } from "@anvia/core/completion";
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
} from "@anvia/core/observability";
import { compact } from "../runtime/compact";
import {
  compactJsonObject,
  serializeUnknown as serializeError,
  toJsonValue,
} from "../runtime/json";
import type {
  StudioTrace,
  StudioTraceObservation,
  StudioTraceStatus,
  StudioTraceStore,
} from "../types";

export type StudioTraceObserverOptions = {
  store: StudioTraceStore | (() => StudioTraceStore | undefined) | undefined;
};

export class StudioTraceObserver implements AgentObserver {
  constructor(private readonly options: StudioTraceObserverOptions) {}

  startRun(args: AgentRunStartArgs): AgentRunObserver {
    const traceId = args.trace?.traceId ?? globalThis.crypto.randomUUID().replaceAll("-", "");
    const observationId = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    return new StudioRunTraceObserver({
      id: traceId,
      observationId,
      args,
      store: this.store(),
    });
  }

  private store(): StudioTraceStore | undefined {
    return typeof this.options.store === "function" ? this.options.store() : this.options.store;
  }
}

class StudioRunTraceObserver implements AgentRunObserver {
  readonly trace: { traceId: string; observationId: string };
  private readonly startedAt = new Date();
  private readonly observations: StudioTraceObservation[] = [];

  constructor(
    private readonly props: {
      id: string;
      observationId: string;
      args: AgentRunStartArgs;
      store: StudioTraceStore | undefined;
    },
  ) {
    this.trace = { traceId: props.id, observationId: props.observationId };
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    const startedAt = new Date();
    return {
      end: (endArgs: AgentGenerationEndArgs) => {
        this.observations.push(
          traceObservation({
            kind: "generation",
            name: `model.turn.${args.turn}`,
            status: "success",
            turn: args.turn,
            startedAt,
            input: toJsonValue(args.request),
            output: toJsonValue(endArgs.response),
            metadata: generationMetadata(args, endArgs),
          }),
        );
      },
      error: (errorArgs: AgentGenerationErrorArgs) => {
        this.observations.push(
          traceObservation({
            kind: "generation",
            name: `model.turn.${args.turn}`,
            status: "error",
            turn: args.turn,
            startedAt,
            input: toJsonValue(args.request),
            error: serializeError(errorArgs.error),
            metadata: generationMetadata(args),
          }),
        );
      },
    };
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const startedAt = new Date();
    const childTrace = new ChildAgentToolTraceAccumulator(args);
    return {
      streamEvent: (streamArgs: AgentToolStreamEventArgs) => {
        childTrace.accept(streamArgs);
      },
      end: (endArgs: AgentToolEndArgs) => {
        const parentObservation = traceObservation({
          kind: "tool",
          name: args.toolName,
          status: "success",
          turn: args.turn,
          startedAt,
          input: parseOrString(args.args),
          output: parseOrString(endArgs.result),
          metadata: toolMetadata(args, endArgs.skipped, endArgs.result),
        });
        this.observations.push(parentObservation);
        this.observations.push(...childTrace.observations(parentObservation.id));
      },
      error: (errorArgs: AgentToolErrorArgs) => {
        const parentObservation = traceObservation({
          kind: "tool",
          name: args.toolName,
          status: "error",
          turn: args.turn,
          startedAt,
          input: parseOrString(args.args),
          error: serializeError(errorArgs.error),
          metadata: toolMetadata(args, false),
        });
        this.observations.push(parentObservation);
        this.observations.push(...childTrace.observations(parentObservation.id));
      },
    };
  }

  async end(args: AgentRunEndArgs): Promise<void> {
    await this.save("success", {
      endedAt: new Date(),
      output: args.output,
      usage: args.usage,
      messages: toJsonValue(args.messages),
    });
  }

  async error(args: AgentRunErrorArgs): Promise<void> {
    await this.save("error", {
      endedAt: new Date(),
      error: serializeError(args.error),
      usage: args.usage,
      messages: toJsonValue(args.messages),
    });
  }

  private async save(
    status: StudioTraceStatus,
    result: {
      endedAt: Date;
      output?: string;
      error?: JsonValue;
      usage: StudioTrace["usage"];
      messages: JsonValue;
    },
  ): Promise<void> {
    const sessionId = this.props.args.trace?.sessionId;
    const store = this.props.store;
    if (sessionId === undefined || store === undefined) {
      return;
    }

    const metadata = traceMetadata(this.props.args, result.messages);
    const trace: StudioTrace = {
      id: this.props.id,
      sessionId,
      ...compact({ name: this.props.args.trace?.name }),
      status,
      trace: this.trace,
      startedAt: this.startedAt.toISOString(),
      endedAt: result.endedAt.toISOString(),
      durationMs: durationMs(this.startedAt, result.endedAt),
      input: toJsonValue({
        instructions: this.props.args.instructions,
        prompt: this.props.args.prompt,
        history: this.props.args.history,
      }),
      ...compact({ output: result.output }),
      ...compact({ error: result.error }),
      ...compact({ usage: result.usage }),
      metadata,
      observations: this.observations,
      observationCount: this.observations.length,
    };

    await store.saveTrace(trace);
  }
}

class ChildAgentToolTraceAccumulator {
  private readonly agentStarts = new Map<
    string,
    {
      startedAt: Date;
      agentId: string;
      agentName?: string;
    }
  >();
  private readonly generationStarts = new Map<
    string,
    {
      startedAt: Date;
      input?: JsonValue;
      agentId: string;
      agentName?: string;
      childTurn: number;
    }
  >();
  private readonly toolStarts: Array<{
    startedAt: Date;
    agentId: string;
    agentName?: string;
    childTurn: number;
    toolName: string;
    toolCallId?: string;
    internalCallId?: string;
    input?: JsonValue;
    completed: boolean;
  }> = [];
  private readonly completedObservations: StudioTraceObservation[] = [];

  constructor(private readonly parent: AgentToolStartArgs) {}

  accept(args: AgentToolStreamEventArgs): void {
    const wrapper = args.event;
    const child = isRecord(wrapper.event) ? wrapper.event : undefined;
    if (child === undefined) {
      return;
    }

    const agentId = wrapper.agentId;
    const agentName = wrapper.agentName;
    const childTurn = typeof child.turn === "number" ? child.turn : this.parent.turn;

    if (!this.agentStarts.has(agentId)) {
      this.agentStarts.set(agentId, {
        startedAt: new Date(),
        agentId,
        ...compact({ agentName }),
      });
    }

    if (child.type === "turn_start") {
      this.generationStarts.set(generationKey(agentId, childTurn), {
        startedAt: new Date(),
        input: toJsonValue({
          prompt: child.prompt,
          history: child.history,
        }),
        agentId,
        ...compact({ agentName }),
        childTurn,
      });
      return;
    }

    if (child.type === "turn_end") {
      const key = generationKey(agentId, childTurn);
      const start = this.generationStarts.get(key);
      this.generationStarts.delete(key);
      this.completedObservations.push(
        traceObservation({
          kind: "generation",
          name: `${agentLabel(agentId, agentName)}.model.turn.${childTurn}`,
          status: "success",
          turn: this.parent.turn,
          startedAt: start?.startedAt ?? new Date(),
          ...compact({ input: start?.input }),
          output: toJsonValue(child.response),
          metadata: this.childMetadata(agentId, agentName, childTurn),
        }),
      );
      return;
    }

    if (child.type === "tool_call" && isRecord(child.toolCall)) {
      const toolCall = child.toolCall;
      const toolCallFunction = isRecord(toolCall.function) ? toolCall.function : undefined;
      const toolName = typeof toolCallFunction?.name === "string" ? toolCallFunction.name : "tool";
      const callId =
        typeof toolCall.callId === "string"
          ? toolCall.callId
          : typeof toolCall.id === "string"
            ? toolCall.id
            : undefined;
      this.toolStarts.push({
        startedAt: new Date(),
        agentId,
        ...compact({ agentName }),
        childTurn,
        toolName,
        ...compact({ toolCallId: callId }),
        input: toJsonValue(toolCallFunction?.arguments ?? {}),
        completed: false,
      });
      return;
    }

    if (child.type === "tool_result") {
      const toolName = typeof child.toolName === "string" ? child.toolName : "tool";
      const toolCallId = typeof child.toolCallId === "string" ? child.toolCallId : undefined;
      const internalCallId =
        typeof child.internalCallId === "string" ? child.internalCallId : undefined;
      const start = this.findToolStart(agentId, toolName, toolCallId);
      const input =
        start?.input ?? (typeof child.args === "string" ? parseOrString(child.args) : undefined);
      if (start !== undefined) {
        start.completed = true;
      }
      this.completedObservations.push(
        traceObservation({
          kind: "tool",
          name: `${agentLabel(agentId, agentName)}.${toolName}`,
          status: "success",
          turn: this.parent.turn,
          startedAt: start?.startedAt ?? new Date(),
          ...compact({ input }),
          ...(typeof child.result === "string" ? { output: parseOrString(child.result) } : {}),
          metadata: {
            ...this.childMetadata(agentId, agentName, childTurn),
            ...compact({ toolCallId }),
            ...compact({ internalCallId }),
          },
        }),
      );
      return;
    }

    if (child.type === "error") {
      this.completedObservations.push(
        traceObservation({
          kind: "tool",
          name: `${agentLabel(agentId, agentName)}.error`,
          status: "error",
          turn: this.parent.turn,
          startedAt: new Date(),
          error: serializeError(child.error),
          metadata: this.childMetadata(agentId, agentName, childTurn),
        }),
      );
    }
  }

  observations(parentObservationId: string): StudioTraceObservation[] {
    const observations: StudioTraceObservation[] = [];
    const agentObservationIds = new Map<string, string>();

    for (const agentStart of this.agentStarts.values()) {
      const agentChildren = this.completedObservations.filter(
        (observation) =>
          isRecord(observation.metadata) &&
          observation.metadata.childAgentId === agentStart.agentId,
      );
      const childStartTimes = agentChildren.map((observation) => Date.parse(observation.startedAt));
      const childEndTimes = agentChildren.map((observation) =>
        Date.parse(observation.endedAt ?? observation.startedAt),
      );
      const startedAt =
        childStartTimes.length === 0
          ? agentStart.startedAt
          : new Date(Math.min(agentStart.startedAt.getTime(), ...childStartTimes));
      const endedAt =
        childEndTimes.length === 0 ? new Date() : new Date(Math.max(...childEndTimes));
      const agentObservation = traceObservation({
        parentObservationId,
        kind: "agent",
        name: `${agentLabel(agentStart.agentId, agentStart.agentName)}.run`,
        status: agentChildren.some((observation) => observation.status === "error")
          ? "error"
          : "success",
        turn: this.parent.turn,
        startedAt,
        endedAt,
        metadata: this.childMetadata(agentStart.agentId, agentStart.agentName, this.parent.turn),
      });
      observations.push(agentObservation);
      agentObservationIds.set(agentStart.agentId, agentObservation.id);
    }

    for (const observation of this.completedObservations) {
      const childAgentId = isRecord(observation.metadata)
        ? stringValue(observation.metadata.childAgentId)
        : undefined;
      const childAgentObservationId =
        childAgentId === undefined ? undefined : agentObservationIds.get(childAgentId);
      observations.push({
        ...observation,
        parentObservationId: childAgentObservationId ?? parentObservationId,
      });
    }

    return observations;
  }

  private findToolStart(
    agentId: string,
    toolName: string,
    toolCallId: string | undefined,
  ): (typeof this.toolStarts)[number] | undefined {
    for (let index = this.toolStarts.length - 1; index >= 0; index -= 1) {
      const start = this.toolStarts[index];
      if (
        start === undefined ||
        start.completed ||
        start.agentId !== agentId ||
        start.toolName !== toolName
      ) {
        continue;
      }
      if (toolCallId === undefined || start.toolCallId === toolCallId) {
        return start;
      }
    }
    return undefined;
  }

  private childMetadata(
    agentId: string,
    agentName: string | undefined,
    childTurn: number,
  ): JsonObject {
    return compactJsonObject({
      source: "agent_tool_event",
      childAgentId: agentId,
      childAgentName: agentName,
      childTurn,
      parentToolName: this.parent.toolName,
      parentInternalCallId: this.parent.internalCallId,
      parentToolCallId: this.parent.toolCallId,
    });
  }
}

function generationKey(agentId: string, turn: number): string {
  return `${agentId}:${turn}`;
}

function agentLabel(agentId: string, agentName: string | undefined): string {
  return (agentName ?? agentId).replaceAll(/\s+/g, "_");
}

function traceObservation(props: {
  parentObservationId?: string;
  kind: StudioTraceObservation["kind"];
  name: string;
  status: StudioTraceStatus;
  turn: number;
  startedAt: Date;
  endedAt?: Date;
  input?: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  metadata?: JsonObject;
}): StudioTraceObservation {
  const endedAt = props.endedAt ?? new Date();
  return {
    id: globalThis.crypto.randomUUID(),
    ...(props.parentObservationId === undefined
      ? {}
      : { parentObservationId: props.parentObservationId }),
    kind: props.kind,
    name: props.name,
    status: props.status,
    turn: props.turn,
    startedAt: props.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: durationMs(props.startedAt, endedAt),
    ...compact({ input: props.input }),
    ...compact({ output: props.output }),
    ...compact({ error: props.error }),
    ...compact({ metadata: props.metadata }),
  };
}

function traceMetadata(args: AgentRunStartArgs, messages: JsonValue): JsonObject {
  return compactJsonObject({
    agentName: args.agentName,
    agentDescription: args.agentDescription,
    maxTurns: args.maxTurns,
    userId: args.trace?.userId,
    tags: args.trace?.tags,
    version: args.trace?.version,
    metadata: toJsonValue(args.trace?.metadata ?? {}),
    messages,
  });
}

function generationMetadata(
  args: AgentGenerationStartArgs,
  endArgs?: AgentGenerationEndArgs,
): JsonObject {
  const request = args.request;
  const response = endArgs?.response;
  const rawResponse = isRecord(response?.rawResponse) ? response.rawResponse : undefined;
  const effectiveModel =
    request.model ?? stringValue(rawResponse?.model) ?? args.modelInfo?.defaultModel ?? "default";
  const providerResponse = providerResponseSummary(rawResponse);
  const usage = response?.usage;

  return compactJsonObject({
    provider: args.modelInfo?.provider,
    model: effectiveModel,
    requestedModel: request.model,
    defaultModel: args.modelInfo?.defaultModel,
    messageId: response?.messageId,
    usage,
    toolCount: request.tools.length,
    toolNames: request.tools.map((tool) => tool.name),
    documentCount: request.documents.length,
    historyCount: request.chatHistory.length,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolChoice: request.toolChoice,
    additionalParamKeys: isRecord(request.additionalParams)
      ? Object.keys(request.additionalParams).sort()
      : undefined,
    hasOutputSchema: request.outputSchema !== undefined,
    firstDeltaMs: endArgs?.firstDeltaMs,
    providerResponse,
    modelInfo: compactJsonObject({
      provider: args.modelInfo?.provider,
      model: effectiveModel,
      requestedModel: request.model,
      defaultModel: args.modelInfo?.defaultModel,
      capabilities: args.modelInfo?.capabilities,
    }),
    modelCall: compactJsonObject({
      request: completionRequestSummary(request),
      providerRequest: args.providerRequest,
    }),
    response: compactJsonObject({
      messageId: response?.messageId,
      usage,
      contentTypes: response?.choice.map((item) => item.type),
      providerResponse,
    }),
    tools: compactJsonObject({
      count: request.tools.length,
      names: request.tools.map((tool) => tool.name),
      toolChoice: request.toolChoice,
      hasOutputSchema: request.outputSchema !== undefined,
    }),
    timing: compactJsonObject({
      firstDeltaMs: endArgs?.firstDeltaMs,
    }),
  });
}

function completionRequestSummary(request: AgentGenerationStartArgs["request"]): JsonObject {
  return compactJsonObject({
    model: request.model,
    instructions: request.instructions === undefined ? undefined : { present: true },
    messageCount: request.chatHistory.length,
    documentCount: request.documents.length,
    documentIds: request.documents.map((document) => document.id),
    toolCount: request.tools.length,
    toolNames: request.tools.map((tool) => tool.name),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolChoice: request.toolChoice,
    additionalParamKeys: isRecord(request.additionalParams)
      ? Object.keys(request.additionalParams).sort()
      : undefined,
    hasOutputSchema: request.outputSchema !== undefined,
  });
}

function providerResponseSummary(
  rawResponse: Record<string, unknown> | undefined,
): JsonObject | undefined {
  if (rawResponse === undefined) {
    return undefined;
  }
  const reasoning = isRecord(rawResponse.reasoning) ? rawResponse.reasoning : undefined;
  const text = isRecord(rawResponse.text) ? rawResponse.text : undefined;
  const toolUsage = isRecord(rawResponse.tool_usage) ? rawResponse.tool_usage : undefined;
  const webSearch = isRecord(toolUsage?.web_search) ? toolUsage.web_search : undefined;
  const summary = compactJsonObject({
    id: rawResponse.id,
    status: rawResponse.status,
    serviceTier: rawResponse.service_tier,
    store: rawResponse.store,
    parallelToolCalls: rawResponse.parallel_tool_calls,
    promptCacheKey: rawResponse.prompt_cache_key,
    promptCacheRetention: rawResponse.prompt_cache_retention,
    reasoningEffort: reasoning?.effort,
    textVerbosity: text?.verbosity,
    webSearchRequestCount: webSearch?.num_requests,
  });
  return Object.keys(summary).length === 0 ? undefined : summary;
}

function toolMetadata(args: AgentToolStartArgs, skipped: boolean, result?: string): JsonObject {
  const schema = isRecord(args.toolDefinition?.parameters) ? args.toolDefinition.parameters : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  return compactJsonObject({
    internalCallId: args.internalCallId,
    toolCallId: args.toolCallId,
    skipped,
    argumentBytes: byteLength(args.args),
    resultBytes: result === undefined ? undefined : byteLength(result),
    hasCallSignature: args.toolCall.signature !== undefined,
    hasAdditionalParams: args.toolCall.additionalParams !== undefined,
    toolDescription: args.toolDefinition?.description,
    parameterKeys: Object.keys(properties).sort(),
    requiredParameterKeys: required,
    approvalRequired: args.toolMetadata?.approvalRequired,
    mcpServerName: args.toolMetadata?.mcpServerName,
    tools: compactJsonObject({
      name: args.toolName,
      internalCallId: args.internalCallId,
      toolCallId: args.toolCallId,
      skipped,
      description: args.toolDefinition?.description,
      parameterKeys: Object.keys(properties).sort(),
      requiredParameterKeys: required,
      approvalRequired: args.toolMetadata?.approvalRequired,
      mcpServerName: args.toolMetadata?.mcpServerName,
      argumentBytes: byteLength(args.args),
      resultBytes: result === undefined ? undefined : byteLength(result),
      hasCallSignature: args.toolCall.signature !== undefined,
      hasAdditionalParams: args.toolCall.additionalParams !== undefined,
    }),
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function durationMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

function parseOrString(value: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(value));
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
