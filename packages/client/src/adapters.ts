import type { AgentChildStreamEvent, AgentStreamEvent } from "@anvia/core/agent";
import {
  type AssistantContentPart,
  type CompletionResponse,
  type CompletionSource,
  type CompletionStreamEvent,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type ProviderToolCall,
  type ToolCallPart,
  type ToolResultContentPart,
  type ToolResultOutput,
} from "@anvia/core/completion";
import { createClientId } from "./messages";
import { maskedClientError } from "./protocol";
import type {
  ClientDataMap,
  ClientErrorMapper,
  ClientOutputMapper,
  ClientStream,
  ClientStreamError,
  ClientStreamEvent,
  ClientStreamScope,
  UIAttachment,
  UIMessagePart,
  UIToolMessagePart,
} from "./types";

export type ClientStreamAdapterOptions<Metadata extends JsonObject = JsonObject> = {
  /** Stable correlation ID for this client-visible run. */
  runId?: string;
  metadata?: Metadata;
  mapError?: ClientErrorMapper;
  mapOutput?: ClientOutputMapper;
};

export type CompletionClientStreamOptions<Metadata extends JsonObject = JsonObject> =
  ClientStreamAdapterOptions<Metadata> & {
    model?: { provider: string; modelId: string };
  };

export type AgentClientStreamContext = {
  runId: string;
  turn?: number;
  scope?: ClientStreamScope;
};

export type AgentClientStreamOptions<
  CustomEvent = unknown,
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
> = ClientStreamAdapterOptions<Metadata> & {
  mapCustomEvent?: (
    event: CustomEvent,
    context: AgentClientStreamContext,
  ) => ClientStreamEvent<Metadata, Data> | readonly ClientStreamEvent<Metadata, Data>[] | undefined;
};

type ReasoningState = {
  partId: string;
  reasoningId?: string;
  text: string;
  ended: boolean;
};

type ToolState = {
  partId: string;
  toolCallId: string;
  callId?: string;
  internalCallId?: string;
  toolName?: string;
  input: JsonValue;
  signature?: string;
  result?:
    | { status: "success"; output: JsonValue; content?: readonly ToolResultContentPart[] }
    | { status: "error"; error: ClientStreamError };
  started: boolean;
  ended: boolean;
};

type MessageState = {
  runId: string;
  messageId: string;
  turn?: number;
  scope?: ClientStreamScope;
  started: boolean;
  ended: boolean;
  textPartId: string;
  text: string;
  textStarted: boolean;
  textEnded: boolean;
  reasoning: Map<string, ReasoningState>;
  tools: Map<string, ToolState>;
  sourceFingerprints: Set<string>;
  providerToolCallFingerprints: Set<string>;
  modelMessageId?: string;
};

type FinalMessageMetadata = Pick<CompletionResponse, "usage" | "contextUsage"> & {
  sources?: readonly CompletionSource[];
  providerToolCalls?: readonly ProviderToolCall[];
};

type AgentAdapterRuntime = {
  runId: string;
  options: AgentClientStreamOptions;
  messages: Map<string, MessageState>;
  startedScopes: Set<string>;
};

type WithoutEventBase<T> = T extends unknown ? Omit<T, "runId" | "turn" | "scope"> : never;
type ClientEventPayload = WithoutEventBase<ClientStreamEvent>;
type ClientEventOf<Type extends ClientEventPayload["type"]> = Extract<
  ClientEventPayload,
  { type: Type }
>;

export function completionToClientStream<
  Output = string,
  RawResponse = unknown,
  Metadata extends JsonObject = JsonObject,
>(
  options: CompletionClientStreamOptions<Metadata> & {
    events: AsyncIterable<CompletionStreamEvent<Output, RawResponse>>;
  },
): ClientStream<Metadata> {
  const { events } = options;
  const runId = options.runId ?? createClientId("run");

  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      const state = createMessageState({ runId });
      const runStart: ClientEventOf<"run_start"> = {
        type: "run_start",
        source: "completion",
      };
      if (options.metadata !== undefined) runStart.metadata = options.metadata;
      yield clientEvent(state, runStart);
      if (options.model !== undefined) {
        yield clientEvent(state, { type: "generation_start", model: options.model });
      }
      yield* startMessage(state);

      let terminal = false;
      try {
        for await (const event of source) {
          if (terminal) break;
          switch (event.type) {
            case "text_delta":
              yield* appendText(state, event.delta);
              break;
            case "reasoning_delta":
              yield* appendReasoning(state, event);
              break;
            case "tool_call_delta":
              yield* appendToolCall(state, event);
              break;
            case "tool_call":
              yield* finishToolCall(state, event.toolCall);
              break;
            case "source":
              yield* emitSource(state, event.source);
              break;
            case "provider_tool_call":
              yield* emitProviderToolCall(state, event.toolCall);
              break;
            case "message_id":
              state.modelMessageId = event.id;
              break;
            case "final": {
              const result = event.result;
              if (result.messageId !== undefined) state.modelMessageId = result.messageId;
              const finalMetadata: FinalMessageMetadata = {
                usage: result.usage,
              };
              if (result.contextUsage !== undefined) {
                finalMetadata.contextUsage = result.contextUsage;
              }
              if (result.sources !== undefined) finalMetadata.sources = result.sources;
              if (result.providerToolCalls !== undefined) {
                finalMetadata.providerToolCalls = result.providerToolCalls;
              }
              yield* finishMessage(state, result.content, finalMetadata);
              const output = clientOutput(result.output, options.mapOutput);
              const runEnd: ClientEventOf<"run_end"> = {
                type: "run_end",
                status: "completed",
                text: result.text,
                usage: result.usage,
              };
              if (output !== undefined) runEnd.output = output;
              if (result.contextUsage !== undefined) runEnd.contextUsage = result.contextUsage;
              yield clientEvent(state, runEnd);
              terminal = true;
              break;
            }
            case "error":
              yield* finishErroredRun(state, event.error, event.usage, options.mapError);
              terminal = true;
              break;
          }
        }

        if (!terminal) {
          yield* finishErroredRun(
            state,
            new Error("Completion stream ended without a terminal event."),
            undefined,
            options.mapError,
          );
        }
      } catch (error) {
        if (!terminal) yield* finishErroredRun(state, error, undefined, options.mapError);
      }
    },
  })) as ClientStream<Metadata>;
}

export function agentToClientStream<
  Output = string,
  RawResponse = unknown,
  Metadata extends JsonObject = JsonObject,
>(
  options: AgentClientStreamOptions<unknown, Metadata> & {
    events: AsyncIterable<AgentStreamEvent<Output, RawResponse>>;
  },
): ClientStream<Metadata> {
  const { events } = options;
  const runId = options.runId ?? createClientId("run");
  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      const runtime: AgentAdapterRuntime = {
        runId,
        options,
        messages: new Map(),
        startedScopes: new Set(["root"]),
      };
      const runStart: ClientEventOf<"run_start"> = {
        type: "run_start",
        source: "agent",
      };
      if (options.metadata !== undefined) runStart.metadata = options.metadata;
      yield rootEvent(runId, runStart);

      let terminal = false;
      try {
        for await (const event of source) {
          if (terminal) break;
          yield* translateAgentEvent(runtime, event, undefined);
          terminal = isRootTerminalAgentEvent(event);
        }
        if (!terminal) {
          const error = mapClientError(
            new Error("Agent stream ended without a terminal event."),
            options.mapError,
          );
          yield rootEvent(runId, { type: "error", error });
          yield rootEvent(runId, { type: "run_end", status: "error" });
        }
      } catch (error) {
        if (!terminal) {
          yield rootEvent(runId, {
            type: "error",
            error: mapClientError(error, options.mapError),
          });
          yield rootEvent(runId, { type: "run_end", status: "error" });
        }
      }
    },
  })) as ClientStream<Metadata>;
}

export function customAgentEventsToClientStream<
  CustomEvent,
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(
  options: AgentClientStreamOptions<CustomEvent, Metadata, Data> & {
    events: AsyncIterable<AgentStreamEvent<unknown, unknown> | CustomEvent>;
    mapCustomEvent: NonNullable<
      AgentClientStreamOptions<CustomEvent, Metadata, Data>["mapCustomEvent"]
    >;
  },
): ClientStream<Metadata, Data> {
  return agentToClientStream(
    options as unknown as AgentClientStreamOptions<unknown, Metadata> & {
      events: AsyncIterable<AgentStreamEvent<unknown, unknown>>;
    },
  ) as ClientStream<Metadata, Data>;
}

async function* translateAgentEvent(
  runtime: AgentAdapterRuntime,
  event: AgentStreamEvent<unknown, unknown> | AgentChildStreamEvent<unknown, unknown>,
  scope: ClientStreamScope | undefined,
): AsyncIterable<ClientStreamEvent> {
  if (event.type === "agent_tool_event") {
    const childScope: ClientStreamScope = {
      agentId: event.agentId,
      parentRunId: runtime.runId,
      parentToolName: event.toolName,
      parentToolCallId: event.toolCallId ?? event.internalCallId,
      parentInternalToolCallId: event.internalCallId,
    };
    if (event.agentName !== undefined) childScope.agentName = event.agentName;
    const key = scopeKey(childScope);
    if (!runtime.startedScopes.has(key)) {
      runtime.startedScopes.add(key);
      yield rootEvent(runtime.runId, { type: "run_start", source: "agent" }, childScope);
    }
    yield* translateAgentEvent(runtime, event.event, childScope);
    return;
  }

  const turn = "turn" in event && typeof event.turn === "number" ? event.turn : undefined;
  switch (event.type) {
    case "memory_compaction":
      yield scopedEvent(runtime.runId, turn, scope, {
        type: "memory_compaction",
        originalMessageCount: event.originalMessageCount,
        compactedMessageCount: event.compactedMessageCount,
        retainedMessageCount: event.retainedMessageCount,
        attempts: event.attempts,
        usage: event.usage,
      });
      return;
    case "turn_start":
      yield scopedEvent(runtime.runId, turn, scope, { type: "turn_start" });
      return;
    case "generation_start": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield scopedEvent(runtime.runId, event.turn, scope, {
        type: "generation_start",
        model: {
          provider: event.modelInfo.provider,
          modelId: event.modelInfo.modelId,
        },
      });
      yield* startMessage(state);
      return;
    }
    case "text_delta": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      yield* appendText(state, event.delta);
      return;
    }
    case "reasoning_delta": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      yield* appendReasoning(state, event);
      return;
    }
    case "tool_call_delta": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      yield* appendToolCall(state, event);
      return;
    }
    case "tool_call": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      yield* finishToolCall(state, event.toolCall);
      return;
    }
    case "source": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      yield* emitSource(state, event.source);
      return;
    }
    case "provider_tool_call": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* emitProviderToolCall(state, event.toolCall);
      return;
    }
    case "tool_result": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      const tool = getToolResultState(
        state,
        event.toolName,
        event.toolCallId,
        event.callId,
        event.internalCallId,
      );
      tool.result = clientToolResult(event.output, event.result);
      const resultEvent: ClientEventOf<"tool_result"> = {
        type: "tool_result",
        messageId: state.messageId,
        partId: tool.partId,
        toolCallId: tool.toolCallId,
        internalCallId: event.internalCallId,
        toolName: event.toolName,
        input: parseJsonOrString(event.args),
        result: tool.result,
      };
      if (tool.callId !== undefined) resultEvent.callId = tool.callId;
      yield clientEvent(state, resultEvent);
      return;
    }
    case "turn_end": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      if (event.response.messageId !== undefined) state.modelMessageId = event.response.messageId;
      const finalMetadata: FinalMessageMetadata = {
        usage: event.response.usage,
      };
      if (event.response.contextUsage !== undefined) {
        finalMetadata.contextUsage = event.response.contextUsage;
      }
      if (event.response.sources !== undefined) finalMetadata.sources = event.response.sources;
      if (event.response.providerToolCalls !== undefined) {
        finalMetadata.providerToolCalls = event.response.providerToolCalls;
      }
      yield* finishMessage(state, event.response.choice, finalMetadata);
      const turnEnd: ClientEventOf<"turn_end"> = {
        type: "turn_end",
        usage: event.response.usage,
      };
      if (event.response.contextUsage !== undefined) {
        turnEnd.contextUsage = event.response.contextUsage;
      }
      if (event.firstDeltaMs !== undefined) turnEnd.firstDeltaMs = event.firstDeltaMs;
      yield scopedEvent(runtime.runId, event.turn, scope, turnEnd);
      return;
    }
    case "guardrail_decision":
      yield scopedEvent(runtime.runId, event.turn, scope, {
        type: "guardrail_decision",
        decision: event.decision,
      });
      return;
    case "response":
    case "interaction":
    case "blocked": {
      const result = event;
      if (result.type === "interaction" && scope === undefined) {
        yield scopedEvent(runtime.runId, turn, scope, {
          type: "interaction",
          interaction: result.interaction,
        });
      }
      const output =
        result.type === "response"
          ? clientOutput(result.output, runtime.options.mapOutput)
          : undefined;
      const runEnd: ClientEventOf<"run_end"> = {
        type: "run_end",
        status: agentOutcomeStatus(result.type),
        text: result.text,
        usage: result.usage,
      };
      if (output !== undefined) runEnd.output = output;
      if (result.contextUsage !== undefined) runEnd.contextUsage = result.contextUsage;
      if (result.trace !== undefined) runEnd.trace = clientTrace(result.trace);
      if (result.memoryCompaction !== undefined) {
        runEnd.memoryCompaction = result.memoryCompaction;
      }
      if (runtime.options.metadata !== undefined) runEnd.metadata = runtime.options.metadata;
      yield scopedEvent(runtime.runId, turn, scope, runEnd);
      return;
    }
    case "error": {
      const error = mapClientError(event.error, runtime.options.mapError);
      yield scopedEvent(runtime.runId, turn, scope, { type: "error", error, usage: event.usage });
      yield scopedEvent(runtime.runId, turn, scope, {
        type: "run_end",
        status: "error",
        usage: event.usage,
      });
      return;
    }
    default: {
      const context: { runId: string; turn?: number; scope?: ClientStreamScope } = {
        runId: runtime.runId,
      };
      if (turn !== undefined) context.turn = turn;
      if (scope !== undefined) context.scope = scope;
      const mapped = runtime.options.mapCustomEvent?.(event as unknown, context);
      if (mapped === undefined) return;
      if (Array.isArray(mapped)) {
        yield* mapped;
      } else {
        yield mapped as ClientStreamEvent;
      }
    }
  }
}

function createMessageState(input: {
  runId: string;
  turn?: number;
  scope?: ClientStreamScope;
}): MessageState {
  const state: MessageState = {
    runId: input.runId,
    messageId: createClientId("msg"),
    started: false,
    ended: false,
    textPartId: createClientId("text"),
    text: "",
    textStarted: false,
    textEnded: false,
    reasoning: new Map(),
    tools: new Map(),
    sourceFingerprints: new Set(),
    providerToolCallFingerprints: new Set(),
  };
  if (input.turn !== undefined) state.turn = input.turn;
  if (input.scope !== undefined) state.scope = input.scope;
  return state;
}

function getAgentMessage(
  runtime: AgentAdapterRuntime,
  turn: number,
  scope: ClientStreamScope | undefined,
): MessageState {
  const key = `${scopeKey(scope)}:${turn}`;
  const current = runtime.messages.get(key);
  if (current !== undefined) return current;
  const input: { runId: string; turn: number; scope?: ClientStreamScope } = {
    runId: runtime.runId,
    turn,
  };
  if (scope !== undefined) input.scope = scope;
  const created = createMessageState(input);
  runtime.messages.set(key, created);
  return created;
}

async function* startMessage(state: MessageState): AsyncIterable<ClientStreamEvent> {
  if (state.started) return;
  state.started = true;
  yield clientEvent(state, {
    type: "message_start",
    messageId: state.messageId,
    role: "assistant",
  });
}

async function* appendText(state: MessageState, delta: string): AsyncIterable<ClientStreamEvent> {
  if (!state.textStarted) {
    state.textStarted = true;
    yield clientEvent(state, {
      type: "text_start",
      messageId: state.messageId,
      partId: state.textPartId,
    });
  }
  state.text += delta;
  yield clientEvent(state, {
    type: "text_delta",
    messageId: state.messageId,
    partId: state.textPartId,
    delta,
  });
}

async function* emitSource(
  state: MessageState,
  source: CompletionSource,
): AsyncIterable<ClientStreamEvent> {
  const fingerprint = valueFingerprint(source);
  if (state.sourceFingerprints.has(fingerprint)) return;
  state.sourceFingerprints.add(fingerprint);
  yield clientEvent(state, {
    type: "source",
    messageId: state.messageId,
    partId: createClientId("source"),
    source,
  });
}

async function* emitProviderToolCall(
  state: MessageState,
  toolCall: ProviderToolCall,
): AsyncIterable<ClientStreamEvent> {
  const fingerprint = valueFingerprint(toolCall);
  if (state.providerToolCallFingerprints.has(fingerprint)) return;
  state.providerToolCallFingerprints.add(fingerprint);
  yield clientEvent(state, { type: "provider_tool_call", toolCall });
}

async function* appendReasoning(
  state: MessageState,
  event: {
    delta: string;
    id?: string;
    contentType?: "text" | "summary" | "encrypted" | "redacted";
    signature?: string;
  },
): AsyncIterable<ClientStreamEvent> {
  const key = event.id ?? "default";
  let reasoning = state.reasoning.get(key);
  if (reasoning === undefined) {
    reasoning = {
      partId: createClientId("reasoning"),
      text: "",
      ended: false,
    };
    if (event.id !== undefined) reasoning.reasoningId = event.id;
    state.reasoning.set(key, reasoning);
    const reasoningStart: ClientEventOf<"reasoning_start"> = {
      type: "reasoning_start",
      messageId: state.messageId,
      partId: reasoning.partId,
    };
    if (event.id !== undefined) reasoningStart.reasoningId = event.id;
    yield clientEvent(state, reasoningStart);
  }
  reasoning.text += event.delta;
  const reasoningDelta: ClientEventOf<"reasoning_delta"> = {
    type: "reasoning_delta",
    messageId: state.messageId,
    partId: reasoning.partId,
    delta: event.delta,
  };
  if (event.contentType !== undefined) reasoningDelta.contentType = event.contentType;
  if (event.signature !== undefined) reasoningDelta.signature = event.signature;
  yield clientEvent(state, reasoningDelta);
}

async function* appendToolCall(
  state: MessageState,
  event: {
    id: string;
    callId?: string;
    name?: string;
    argumentsDelta?: string;
    argumentsMode?: "append" | "replace";
    signature?: string;
  },
): AsyncIterable<ClientStreamEvent> {
  const tool = getToolState(state, event.id, event.name);
  if (!tool.started) {
    tool.started = true;
    const toolCallStart: ClientEventOf<"tool_call_start"> = {
      type: "tool_call_start",
      messageId: state.messageId,
      partId: tool.partId,
      toolCallId: event.id,
    };
    if (event.callId !== undefined) toolCallStart.callId = event.callId;
    if (event.name !== undefined) toolCallStart.toolName = event.name;
    yield clientEvent(state, toolCallStart);
  }
  if (event.callId !== undefined) tool.callId = event.callId;
  if (event.name !== undefined) tool.toolName = event.name;
  if (event.signature !== undefined) tool.signature = event.signature;
  if (event.argumentsDelta === undefined) return;
  const mode = event.argumentsMode ?? "append";
  const prior = typeof tool.input === "string" ? tool.input : "";
  tool.input = mode === "replace" ? event.argumentsDelta : `${prior}${event.argumentsDelta}`;
  const toolCallDelta: ClientEventOf<"tool_call_delta"> = {
    type: "tool_call_delta",
    messageId: state.messageId,
    partId: tool.partId,
    toolCallId: event.id,
    delta: event.argumentsDelta,
    mode,
  };
  if (event.callId !== undefined) toolCallDelta.callId = event.callId;
  if (event.name !== undefined) toolCallDelta.toolName = event.name;
  if (event.signature !== undefined) toolCallDelta.signature = event.signature;
  yield clientEvent(state, toolCallDelta);
}

async function* finishToolCall(
  state: MessageState,
  toolCall: ToolCallPart,
): AsyncIterable<ClientStreamEvent> {
  const tool = getToolState(state, toolCall.toolCallId, toolCall.toolName);
  const wasEnded = tool.ended;
  if (!tool.started) {
    tool.started = true;
    const toolCallStart: ClientEventOf<"tool_call_start"> = {
      type: "tool_call_start",
      messageId: state.messageId,
      partId: tool.partId,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
    };
    if (toolCall.callId !== undefined) toolCallStart.callId = toolCall.callId;
    yield clientEvent(state, toolCallStart);
  }
  if (toolCall.callId === undefined) delete tool.callId;
  else tool.callId = toolCall.callId;
  tool.toolName = toolCall.toolName;
  tool.input = toolCall.input;
  if (toolCall.signature === undefined) delete tool.signature;
  else tool.signature = toolCall.signature;
  if (wasEnded) return;
  tool.ended = true;
  const toolCallEnd: ClientEventOf<"tool_call_end"> = {
    type: "tool_call_end",
    messageId: state.messageId,
    partId: tool.partId,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
  };
  if (toolCall.callId !== undefined) toolCallEnd.callId = toolCall.callId;
  if (toolCall.signature !== undefined) toolCallEnd.signature = toolCall.signature;
  yield clientEvent(state, toolCallEnd);
}

async function* finishMessage(
  state: MessageState,
  content: readonly AssistantContentPart[],
  metadata: FinalMessageMetadata,
): AsyncIterable<ClientStreamEvent> {
  if (state.ended) return;
  const textContent = content.filter(
    (part): part is Extract<AssistantContentPart, { type: "text" }> => part.type === "text",
  );
  const text = textContent.map((part) => part.text).join("");
  if (state.textStarted || text.length > 0) {
    if (!state.textStarted) {
      state.textStarted = true;
      yield clientEvent(state, {
        type: "text_start",
        messageId: state.messageId,
        partId: state.textPartId,
      });
    }
    state.text = text;
    state.textEnded = true;
    const textEnd: ClientEventOf<"text_end"> = {
      type: "text_end",
      messageId: state.messageId,
      partId: state.textPartId,
      text,
    };
    if (textContent.length === 1 && textContent[0]?.signature !== undefined) {
      textEnd.signature = textContent[0].signature;
    }
    yield clientEvent(state, textEnd);
  }

  const finalReasoning = content.filter(
    (part): part is Extract<AssistantContentPart, { type: "reasoning" }> =>
      part.type === "reasoning",
  );
  const anonymousReasoning = [...state.reasoning.values()].filter(
    (reasoning) => reasoning.reasoningId === undefined,
  );
  let anonymousIndex = 0;
  for (const [index, reasoning] of finalReasoning.entries()) {
    const existing =
      reasoning.id === undefined
        ? anonymousReasoning[anonymousIndex++]
        : state.reasoning.get(reasoning.id);
    const current = existing ?? createReasoningState(reasoning.id);
    if (existing === undefined) {
      state.reasoning.set(reasoning.id ?? `final:${index}`, current);
      const reasoningStart: ClientEventOf<"reasoning_start"> = {
        type: "reasoning_start",
        messageId: state.messageId,
        partId: current.partId,
      };
      if (reasoning.id !== undefined) reasoningStart.reasoningId = reasoning.id;
      yield clientEvent(state, reasoningStart);
    }
    if (!current.ended) {
      current.ended = true;
      current.text = reasoning.text;
      const reasoningEnd: ClientEventOf<"reasoning_end"> = {
        type: "reasoning_end",
        messageId: state.messageId,
        partId: current.partId,
        text: reasoning.text,
      };
      if (reasoning.details !== undefined) reasoningEnd.content = reasoning.details;
      yield clientEvent(state, reasoningEnd);
    }
  }
  for (const reasoning of state.reasoning.values()) {
    if (reasoning.ended) continue;
    reasoning.ended = true;
    yield clientEvent(state, {
      type: "reasoning_end",
      messageId: state.messageId,
      partId: reasoning.partId,
      text: reasoning.text,
    });
  }

  for (const part of content) {
    if (part.type === "tool-call") yield* finishToolCall(state, part);
    if (part.type === "image" || part.type === "file") {
      const attachment = contentAttachment(part);
      yield clientEvent(state, {
        type: "attachment",
        messageId: state.messageId,
        partId: createClientId("attachment_part"),
        attachment,
      });
    }
  }

  for (const source of metadata.sources ?? []) yield* emitSource(state, source);
  for (const toolCall of metadata.providerToolCalls ?? []) {
    yield* emitProviderToolCall(state, toolCall);
  }

  state.ended = true;
  const messageEnd: ClientEventOf<"message_end"> = {
    type: "message_end",
    messageId: state.messageId,
    parts: contentToUIMessageParts(content, state),
    usage: metadata.usage,
  };
  if (state.modelMessageId !== undefined) messageEnd.modelMessageId = state.modelMessageId;
  if (metadata.contextUsage !== undefined) messageEnd.contextUsage = metadata.contextUsage;
  yield clientEvent(state, messageEnd);
}

async function* finishErroredRun(
  state: MessageState,
  error: unknown,
  usage: CompletionResponse["usage"] | undefined,
  mapper: ClientErrorMapper | undefined,
): AsyncIterable<ClientStreamEvent> {
  const mapped = mapClientError(error, mapper);
  if (state.textStarted && !state.textEnded) {
    state.textEnded = true;
    yield clientEvent(state, {
      type: "text_end",
      messageId: state.messageId,
      partId: state.textPartId,
      text: state.text,
    });
  }
  const errorEvent: ClientEventOf<"error"> = {
    type: "error",
    error: mapped,
  };
  if (usage !== undefined) errorEvent.usage = usage;
  yield clientEvent(state, errorEvent);
  if (!state.ended) {
    state.ended = true;
    const messageEnd: ClientEventOf<"message_end"> = {
      type: "message_end",
      messageId: state.messageId,
    };
    if (state.modelMessageId !== undefined) messageEnd.modelMessageId = state.modelMessageId;
    if (usage !== undefined) messageEnd.usage = usage;
    yield clientEvent(state, messageEnd);
  }
  const runEnd: ClientEventOf<"run_end"> = {
    type: "run_end",
    status: "error",
  };
  if (usage !== undefined) runEnd.usage = usage;
  yield clientEvent(state, runEnd);
}

function contentToUIMessageParts(
  content: readonly AssistantContentPart[],
  state: MessageState,
): UIMessagePart[] {
  let textIndex = 0;
  let anonymousReasoningIndex = 0;
  const anonymousReasoning = [...state.reasoning.values()].filter(
    (reasoning) => reasoning.reasoningId === undefined,
  );
  return content.map((contentPart) => {
    if (contentPart.type === "text") {
      const part: Extract<UIMessagePart, { type: "text" }> = {
        id: textIndex === 0 ? state.textPartId : createClientId("text"),
        type: "text",
        text: contentPart.text,
      };
      textIndex += 1;
      if (contentPart.signature !== undefined) part.signature = contentPart.signature;
      return part;
    }
    if (contentPart.type === "reasoning") {
      const current =
        contentPart.id === undefined
          ? anonymousReasoning[anonymousReasoningIndex++]
          : state.reasoning.get(contentPart.id);
      const part: Extract<UIMessagePart, { type: "reasoning" }> = {
        id: current?.partId ?? createClientId("reasoning"),
        type: "reasoning",
        text: contentPart.text,
      };
      if (contentPart.id !== undefined) part.reasoningId = contentPart.id;
      if (contentPart.details !== undefined) part.content = contentPart.details;
      return part;
    }
    if (contentPart.type === "tool-call") {
      const tool = getToolState(state, contentPart.toolCallId, contentPart.toolName);
      const partBase = {
        id: tool.partId,
        type: "tool" as const,
        toolName: contentPart.toolName,
        toolCallId: contentPart.toolCallId,
      };
      if (contentPart.callId !== undefined) Object.assign(partBase, { callId: contentPart.callId });
      if (tool.internalCallId !== undefined) {
        Object.assign(partBase, { internalCallId: tool.internalCallId });
      }
      if (state.turn !== undefined) Object.assign(partBase, { turn: state.turn });
      if (contentPart.signature !== undefined) {
        Object.assign(partBase, { signature: contentPart.signature });
      }
      if (tool.result?.status === "success") {
        const part: Extract<UIToolMessagePart, { state: "output-available" }> = {
          ...partBase,
          state: "output-available",
          input: contentPart.input,
          output: tool.result.output,
        };
        if (tool.result.content !== undefined) part.resultContent = tool.result.content;
        return part;
      }
      if (tool.result?.status === "error") {
        return {
          ...partBase,
          state: "error",
          input: contentPart.input,
          error: tool.result.error,
        };
      }
      return {
        ...partBase,
        state: "input-available",
        input: contentPart.input,
      };
    }
    const attachment = contentAttachment(contentPart);
    return {
      id: createClientId("attachment_part"),
      type: "attachment",
      attachment,
    };
  });
}

function getToolState(state: MessageState, id: string, name?: string): ToolState {
  let tool = state.tools.get(id);
  if (tool === undefined) {
    tool = {
      partId: createClientId("tool"),
      toolCallId: id,
      input: "",
      started: false,
      ended: false,
    };
    if (name !== undefined) tool.toolName = name;
    state.tools.set(id, tool);
  } else if (name !== undefined) {
    tool.toolName = name;
  }
  return tool;
}

function getToolResultState(
  state: MessageState,
  toolName: string,
  toolCallId: string,
  callId: string | undefined,
  internalCallId: string,
): ToolState {
  const matchedByToolCallId = state.tools.get(toolCallId);
  const matchedByCallId =
    callId === undefined
      ? undefined
      : [...state.tools.values()].find((tool) => tool.callId === callId);
  const tool = matchedByToolCallId ?? matchedByCallId ?? getToolState(state, toolCallId, toolName);
  tool.toolName = toolName;
  if (callId !== undefined) tool.callId = callId;
  tool.internalCallId = internalCallId;
  return tool;
}

function createReasoningState(id?: string): ReasoningState {
  const state: ReasoningState = {
    partId: createClientId("reasoning"),
    text: "",
    ended: false,
  };
  if (id !== undefined) state.reasoningId = id;
  return state;
}

function contentAttachment(
  content: Extract<AssistantContentPart, { type: "image" | "file" }>,
): UIAttachment {
  const attachment: UIAttachment = {
    id: createClientId("attachment"),
    type: content.type === "image" ? "image" : "file",
  };
  if (content.type === "image") {
    if (content.detail !== undefined) attachment.detail = content.detail;
    if (content.mediaType !== undefined) attachment.mediaType = content.mediaType;
    if (content.image.type === "url") attachment.url = content.image.url;
    else attachment.data = content.image.data;
    return attachment;
  }
  attachment.mediaType = content.mediaType;
  if (content.filename !== undefined) attachment.name = content.filename;
  if (content.data.type === "url") {
    attachment.url = content.data.url;
  } else if (content.data.type === "data") {
    attachment.data = content.data.data;
  } else {
    attachment.text = content.data.text;
  }
  return attachment;
}

function clientToolResult(
  output: ToolResultOutput,
  result: string,
): NonNullable<ToolState["result"]> {
  switch (output.type) {
    case "text":
      return { status: "success", output: output.value };
    case "json":
      return { status: "success", output: output.value };
    case "content":
      return { status: "success", output: result, content: output.value };
    case "execution-denied":
      return {
        status: "error",
        error: {
          message: output.reason ?? "Tool execution was denied.",
          code: "tool_execution_denied",
        },
      };
    case "error-text":
      return {
        status: "error",
        error: { message: output.value, code: "tool_execution_error" },
      };
    case "error-json":
      return {
        status: "error",
        error: {
          message: "Tool execution failed.",
          code: "tool_execution_error",
          details: output.value,
        },
      };
  }
}

function parseJsonOrString(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonValue(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function clientOutput(
  output: unknown,
  mapper: ClientOutputMapper | undefined,
): JsonValue | undefined {
  const mapped = mapper === undefined ? (isJsonValue(output) ? output : undefined) : mapper(output);
  if (mapped !== undefined && !isJsonValue(mapped)) {
    throw new TypeError("mapOutput must return a strict JSON value or undefined.");
  }
  return mapped;
}

function valueFingerprint(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(valueFingerprint).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${valueFingerprint(entry)}`)
      .join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

function clientTrace(trace: {
  readonly observer: string;
  readonly traceId?: string | undefined;
  readonly observationId?: string | undefined;
}): { observer: string; traceId?: string; observationId?: string } {
  const result: { observer: string; traceId?: string; observationId?: string } = {
    observer: trace.observer,
  };
  if (trace.traceId !== undefined) result.traceId = trace.traceId;
  if (trace.observationId !== undefined) result.observationId = trace.observationId;
  return result;
}

function mapClientError(error: unknown, mapper: ClientErrorMapper | undefined): ClientStreamError {
  const mapped = mapper?.(error) ?? maskedClientError();
  if (
    typeof mapped.message !== "string" ||
    (mapped.details !== undefined && !isJsonValue(mapped.details))
  ) {
    throw new TypeError("mapError must return a JSON-safe ClientStreamError.");
  }
  return mapped;
}

function clientEvent(state: MessageState, event: ClientEventPayload): ClientStreamEvent {
  return scopedEvent(state.runId, state.turn, state.scope, event);
}

function rootEvent(
  runId: string,
  event: ClientEventPayload,
  scope?: ClientStreamScope,
): ClientStreamEvent {
  return scopedEvent(runId, undefined, scope, event);
}

function scopedEvent(
  runId: string,
  turn: number | undefined,
  scope: ClientStreamScope | undefined,
  event: ClientEventPayload,
): ClientStreamEvent {
  let scoped = { runId, ...event } as ClientStreamEvent;
  if (turn !== undefined) scoped = { ...scoped, turn };
  if (scope !== undefined) scoped = { ...scoped, scope };
  return scoped;
}

function scopeKey(scope: ClientStreamScope | undefined): string {
  if (scope === undefined) return "root";
  return [
    scope.agentId,
    scope.parentRunId,
    scope.parentToolName,
    scope.parentToolCallId,
    scope.parentInternalToolCallId,
  ].join(":");
}

function isRootTerminalAgentEvent(event: AgentStreamEvent<unknown, unknown>): boolean {
  return (
    event.type === "response" ||
    event.type === "interaction" ||
    event.type === "blocked" ||
    event.type === "error"
  );
}

function agentOutcomeStatus(
  type: "response" | "interaction" | "blocked",
): "completed" | "suspended" | "blocked" {
  if (type === "response") return "completed";
  if (type === "interaction") return "suspended";
  return "blocked";
}

function propagateCancellation<TSource, TOutput>(
  source: AsyncIterable<TSource>,
  transform: (source: AsyncIterable<TSource>) => AsyncIterable<TOutput>,
): AsyncIterable<TOutput> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<TOutput> {
      const sourceIterator = source[Symbol.asyncIterator]();
      const sharedSource: AsyncIterable<TSource> = {
        [Symbol.asyncIterator]: () => sourceIterator,
      };
      const outputIterator = transform(sharedSource)[Symbol.asyncIterator]();
      let returned = false;

      return {
        next: () => outputIterator.next(),
        async return(): Promise<IteratorResult<TOutput>> {
          if (returned) return { done: true, value: undefined };
          returned = true;
          const sourceReturn = sourceIterator.return?.();
          const outputReturn = outputIterator.return?.();
          await Promise.all([sourceReturn, outputReturn]);
          return { done: true, value: undefined };
        },
      };
    },
  };
}
