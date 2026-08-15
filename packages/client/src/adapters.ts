import type { AgentChildStreamEvent, AgentStreamEvent } from "@anvia/core/agent";
import {
  type AssistantContent,
  type CompletionResponse,
  type CompletionSource,
  type CompletionStreamEvent,
  isJsonValue,
  type JsonValue,
  type ProviderToolCall,
  type ToolCall,
  type ToolResultContent,
} from "@anvia/core/completion";
import { createClientId } from "./messages";
import { maskedClientError } from "./protocol";
import type {
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

export type ClientStreamAdapterOptions = {
  /** Stable correlation ID for this client-visible run. */
  runId?: string;
  metadata?: JsonValue;
  mapError?: ClientErrorMapper;
  mapOutput?: ClientOutputMapper;
};

export type CompletionClientStreamOptions = ClientStreamAdapterOptions & {
  model?: { provider: string; id: string };
};

export type AgentClientStreamContext = {
  runId: string;
  turn?: number;
  scope?: ClientStreamScope;
};

export type AgentClientStreamOptions<CustomEvent = unknown> = ClientStreamAdapterOptions & {
  mapCustomEvent?: (
    event: CustomEvent,
    context: AgentClientStreamContext,
  ) => ClientStreamEvent | readonly ClientStreamEvent[] | undefined;
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
  additionalParams?: JsonValue;
  result?:
    | { status: "success"; output: JsonValue; content?: ToolResultContent[] }
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

export function completionToClientStream<Output = string, RawResponse = unknown>(
  events: AsyncIterable<CompletionStreamEvent<Output, RawResponse>>,
  options: CompletionClientStreamOptions = {},
): ClientStream {
  const runId = options.runId ?? createClientId("run");

  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      const state = createMessageState({ runId });
      yield clientEvent(state, {
        type: "run_start",
        source: "completion",
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      });
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
              yield* finishMessage(state, result.content, {
                usage: result.usage,
                ...(result.contextUsage === undefined ? {} : { contextUsage: result.contextUsage }),
                ...(result.sources === undefined ? {} : { sources: result.sources }),
                ...(result.providerToolCalls === undefined
                  ? {}
                  : { providerToolCalls: result.providerToolCalls }),
              });
              const output = clientOutput(result.output, options.mapOutput);
              yield clientEvent(state, {
                type: "run_end",
                status: "completed",
                text: result.text,
                ...(output === undefined ? {} : { output }),
                usage: result.usage,
                ...(result.contextUsage === undefined ? {} : { contextUsage: result.contextUsage }),
              });
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
  }));
}

export function agentToClientStream<Output = string, RawResponse = unknown>(
  events: AsyncIterable<AgentStreamEvent<Output, RawResponse>>,
  options: AgentClientStreamOptions = {},
): ClientStream {
  const runId = options.runId ?? createClientId("run");
  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      const runtime: AgentAdapterRuntime = {
        runId,
        options,
        messages: new Map(),
        startedScopes: new Set(["root"]),
      };
      yield rootEvent(runId, {
        type: "run_start",
        source: "agent",
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      });

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
  }));
}

export function customAgentEventsToClientStream<CustomEvent>(
  events: AsyncIterable<AgentStreamEvent<unknown, unknown> | CustomEvent>,
  options: AgentClientStreamOptions<CustomEvent> & {
    mapCustomEvent: NonNullable<AgentClientStreamOptions<CustomEvent>["mapCustomEvent"]>;
  },
): ClientStream {
  return agentToClientStream(
    events as AsyncIterable<AgentStreamEvent<unknown, unknown>>,
    options as AgentClientStreamOptions,
  );
}

async function* translateAgentEvent(
  runtime: AgentAdapterRuntime,
  event: AgentStreamEvent<unknown, unknown> | AgentChildStreamEvent<unknown, unknown>,
  scope: ClientStreamScope | undefined,
): AsyncIterable<ClientStreamEvent> {
  if (event.type === "agent_tool_event") {
    const childScope: ClientStreamScope = {
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      parentRunId: runtime.runId,
      parentToolName: event.toolName,
      parentToolCallId: event.toolCallId ?? event.internalCallId,
      parentInternalToolCallId: event.internalCallId,
    };
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
    case "turn_start":
      yield scopedEvent(runtime.runId, turn, scope, { type: "turn_start" });
      return;
    case "generation_start": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield scopedEvent(runtime.runId, event.turn, scope, {
        type: "generation_start",
        model: {
          provider: event.modelInfo.provider,
          id: event.request.model ?? event.modelInfo.defaultModel,
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
      const output = toolResultOutput(event.result, event.structuredResult);
      tool.result = {
        status: "success",
        output,
        ...(event.structuredResult === undefined ? {} : { content: event.structuredResult }),
      };
      yield clientEvent(state, {
        type: "tool_result",
        messageId: state.messageId,
        partId: tool.partId,
        toolCallId: tool.toolCallId,
        ...(tool.callId === undefined ? {} : { callId: tool.callId }),
        internalCallId: event.internalCallId,
        toolName: event.toolName,
        input: parseJsonOrString(event.args),
        result: tool.result,
      });
      return;
    }
    case "turn_end": {
      const state = getAgentMessage(runtime, event.turn, scope);
      yield* startMessage(state);
      if (event.response.messageId !== undefined) state.modelMessageId = event.response.messageId;
      yield* finishMessage(state, event.response.choice, {
        usage: event.response.usage,
        ...(event.response.contextUsage === undefined
          ? {}
          : { contextUsage: event.response.contextUsage }),
        ...(event.response.sources === undefined ? {} : { sources: event.response.sources }),
        ...(event.response.providerToolCalls === undefined
          ? {}
          : { providerToolCalls: event.response.providerToolCalls }),
      });
      yield scopedEvent(runtime.runId, event.turn, scope, {
        type: "turn_end",
        usage: event.response.usage,
        ...(event.response.contextUsage === undefined
          ? {}
          : { contextUsage: event.response.contextUsage }),
        ...(event.firstDeltaMs === undefined ? {} : { firstDeltaMs: event.firstDeltaMs }),
      });
      return;
    }
    case "guardrail_decision":
      yield scopedEvent(runtime.runId, event.turn, scope, {
        type: "guardrail_decision",
        decision: event.decision,
      });
      return;
    case "approval_required": {
      const input = jsonValueOrUndefined(event.approval.input);
      yield scopedEvent(runtime.runId, turn, scope, {
        type: "tool_approval",
        approval: {
          id: event.approval.id,
          runId: event.runId,
          toolName: event.approval.toolName,
          ...(event.approval.toolCallId === undefined ? {} : { callId: event.approval.toolCallId }),
          ...(input === undefined ? {} : { input }),
          status: "pending",
          ...(event.approval.reason === undefined ? {} : { reason: event.approval.reason }),
        },
      });
      yield scopedEvent(runtime.runId, turn, scope, {
        type: "run_end",
        status: "approval_required",
        usage: event.usage,
        metadata: { nativeRunId: event.runId },
      });
      return;
    }
    case "final": {
      const result = event.result;
      const output =
        result.status === "completed"
          ? clientOutput(result.output, runtime.options.mapOutput)
          : undefined;
      yield scopedEvent(runtime.runId, turn, scope, {
        type: "run_end",
        status: result.status,
        text: result.text,
        ...(output === undefined ? {} : { output }),
        usage: result.usage,
        ...(result.contextUsage === undefined ? {} : { contextUsage: result.contextUsage }),
        ...(result.trace === undefined ? {} : { trace: clientTrace(result.trace) }),
        metadata: { nativeRunId: result.runId },
      });
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
      const mapped = runtime.options.mapCustomEvent?.(event as unknown, {
        runId: runtime.runId,
        ...(turn === undefined ? {} : { turn }),
        ...(scope === undefined ? {} : { scope }),
      });
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
  return {
    runId: input.runId,
    messageId: createClientId("msg"),
    ...(input.turn === undefined ? {} : { turn: input.turn }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
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
}

function getAgentMessage(
  runtime: AgentAdapterRuntime,
  turn: number,
  scope: ClientStreamScope | undefined,
): MessageState {
  const key = `${scopeKey(scope)}:${turn}`;
  const current = runtime.messages.get(key);
  if (current !== undefined) return current;
  const created = createMessageState({
    runId: runtime.runId,
    turn,
    ...(scope === undefined ? {} : { scope }),
  });
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
      ...(event.id === undefined ? {} : { reasoningId: event.id }),
      text: "",
      ended: false,
    };
    state.reasoning.set(key, reasoning);
    yield clientEvent(state, {
      type: "reasoning_start",
      messageId: state.messageId,
      partId: reasoning.partId,
      ...(event.id === undefined ? {} : { reasoningId: event.id }),
    });
  }
  reasoning.text += event.delta;
  yield clientEvent(state, {
    type: "reasoning_delta",
    messageId: state.messageId,
    partId: reasoning.partId,
    delta: event.delta,
    ...(event.contentType === undefined ? {} : { contentType: event.contentType }),
    ...(event.signature === undefined ? {} : { signature: event.signature }),
  });
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
    yield clientEvent(state, {
      type: "tool_call_start",
      messageId: state.messageId,
      partId: tool.partId,
      toolCallId: event.id,
      ...(event.callId === undefined ? {} : { callId: event.callId }),
      ...(event.name === undefined ? {} : { toolName: event.name }),
    });
  }
  if (event.callId !== undefined) tool.callId = event.callId;
  if (event.name !== undefined) tool.toolName = event.name;
  if (event.signature !== undefined) tool.signature = event.signature;
  if (event.argumentsDelta === undefined) return;
  const mode = event.argumentsMode ?? "append";
  const prior = typeof tool.input === "string" ? tool.input : "";
  tool.input = mode === "replace" ? event.argumentsDelta : `${prior}${event.argumentsDelta}`;
  yield clientEvent(state, {
    type: "tool_call_delta",
    messageId: state.messageId,
    partId: tool.partId,
    toolCallId: event.id,
    ...(event.callId === undefined ? {} : { callId: event.callId }),
    ...(event.name === undefined ? {} : { toolName: event.name }),
    delta: event.argumentsDelta,
    mode,
    ...(event.signature === undefined ? {} : { signature: event.signature }),
  });
}

async function* finishToolCall(
  state: MessageState,
  toolCall: ToolCall,
): AsyncIterable<ClientStreamEvent> {
  const tool = getToolState(state, toolCall.id, toolCall.function.name);
  const wasEnded = tool.ended;
  if (!tool.started) {
    tool.started = true;
    yield clientEvent(state, {
      type: "tool_call_start",
      messageId: state.messageId,
      partId: tool.partId,
      toolCallId: toolCall.id,
      ...(toolCall.callId === undefined ? {} : { callId: toolCall.callId }),
      toolName: toolCall.function.name,
    });
  }
  if (toolCall.callId === undefined) delete tool.callId;
  else tool.callId = toolCall.callId;
  tool.toolName = toolCall.function.name;
  tool.input = toolCall.function.arguments;
  if (toolCall.signature === undefined) delete tool.signature;
  else tool.signature = toolCall.signature;
  if (toolCall.additionalParams === undefined) delete tool.additionalParams;
  else tool.additionalParams = toolCall.additionalParams;
  if (wasEnded) return;
  tool.ended = true;
  yield clientEvent(state, {
    type: "tool_call_end",
    messageId: state.messageId,
    partId: tool.partId,
    toolCallId: toolCall.id,
    ...(toolCall.callId === undefined ? {} : { callId: toolCall.callId }),
    toolName: toolCall.function.name,
    input: toolCall.function.arguments,
    ...(toolCall.signature === undefined ? {} : { signature: toolCall.signature }),
    ...(toolCall.additionalParams === undefined
      ? {}
      : { additionalParams: toolCall.additionalParams }),
  });
}

async function* finishMessage(
  state: MessageState,
  content: readonly AssistantContent[],
  metadata: FinalMessageMetadata,
): AsyncIterable<ClientStreamEvent> {
  if (state.ended) return;
  const textContent = content.filter(
    (part): part is Extract<AssistantContent, { type: "text" }> => part.type === "text",
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
    yield clientEvent(state, {
      type: "text_end",
      messageId: state.messageId,
      partId: state.textPartId,
      text,
      ...(textContent.length === 1 && textContent[0]?.signature !== undefined
        ? { signature: textContent[0].signature }
        : {}),
    });
  }

  const finalReasoning = content.filter(
    (part): part is Extract<AssistantContent, { type: "reasoning" }> => part.type === "reasoning",
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
      yield clientEvent(state, {
        type: "reasoning_start",
        messageId: state.messageId,
        partId: current.partId,
        ...(reasoning.id === undefined ? {} : { reasoningId: reasoning.id }),
      });
    }
    if (!current.ended) {
      current.ended = true;
      current.text = reasoning.text;
      yield clientEvent(state, {
        type: "reasoning_end",
        messageId: state.messageId,
        partId: current.partId,
        text: reasoning.text,
        ...(reasoning.content === undefined ? {} : { content: reasoning.content }),
      });
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
    if (part.type === "tool_call") yield* finishToolCall(state, part);
    if (part.type === "image") {
      const attachment = imageAttachment(part);
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
  yield clientEvent(state, {
    type: "message_end",
    messageId: state.messageId,
    ...(state.modelMessageId === undefined ? {} : { modelMessageId: state.modelMessageId }),
    parts: contentToUIMessageParts(content, state),
    usage: metadata.usage,
    ...(metadata.contextUsage === undefined ? {} : { contextUsage: metadata.contextUsage }),
  });
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
  yield clientEvent(state, {
    type: "error",
    error: mapped,
    ...(usage === undefined ? {} : { usage }),
  });
  if (!state.ended) {
    state.ended = true;
    yield clientEvent(state, {
      type: "message_end",
      messageId: state.messageId,
      ...(state.modelMessageId === undefined ? {} : { modelMessageId: state.modelMessageId }),
      ...(usage === undefined ? {} : { usage }),
    });
  }
  yield clientEvent(state, {
    type: "run_end",
    status: "error",
    ...(usage === undefined ? {} : { usage }),
  });
}

function contentToUIMessageParts(
  content: readonly AssistantContent[],
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
      if (contentPart.content !== undefined) part.content = contentPart.content;
      return part;
    }
    if (contentPart.type === "tool_call") {
      const tool = getToolState(state, contentPart.id, contentPart.function.name);
      const part: UIToolMessagePart = {
        id: tool.partId,
        type: "tool",
        toolName: contentPart.function.name,
        toolCallId: contentPart.id,
        state:
          tool.result?.status === "error"
            ? "error"
            : tool.result
              ? "output-available"
              : "input-available",
        input: contentPart.function.arguments,
      };
      if (contentPart.callId !== undefined) part.callId = contentPart.callId;
      if (tool.internalCallId !== undefined) part.internalCallId = tool.internalCallId;
      if (state.turn !== undefined) part.turn = state.turn;
      if (contentPart.signature !== undefined) part.signature = contentPart.signature;
      if (contentPart.additionalParams !== undefined) {
        part.additionalParams = contentPart.additionalParams;
      }
      if (tool.result?.status === "success") {
        part.output = tool.result.output;
        if (tool.result.content !== undefined) part.resultContent = tool.result.content;
      } else if (tool.result?.status === "error") {
        part.error = tool.result.error;
      }
      return part;
    }
    const attachment = imageAttachment(contentPart);
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
      ...(name === undefined ? {} : { toolName: name }),
      input: "",
      started: false,
      ended: false,
    };
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
  return {
    partId: createClientId("reasoning"),
    ...(id === undefined ? {} : { reasoningId: id }),
    text: "",
    ended: false,
  };
}

function imageAttachment(content: Extract<AssistantContent, { type: "image" }>): UIAttachment {
  const attachment: UIAttachment = {
    id: createClientId("attachment"),
    type: "image",
  };
  if (content.detail !== undefined) attachment.detail = content.detail;
  if (content.source.type === "url") {
    attachment.url = content.source.url;
  } else {
    attachment.data = content.source.data;
    attachment.mediaType = content.source.mediaType;
  }
  return attachment;
}

function toolResultOutput(result: string, structured?: ToolResultContent[]): JsonValue {
  return structured ?? parseJsonOrString(result);
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

function jsonValueOrUndefined(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? value : undefined;
}

function clientTrace(trace: {
  readonly traceId?: string | undefined;
  readonly observationId?: string | undefined;
}): { traceId?: string; observationId?: string } {
  return {
    ...(trace.traceId === undefined ? {} : { traceId: trace.traceId }),
    ...(trace.observationId === undefined ? {} : { observationId: trace.observationId }),
  };
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
  return {
    runId,
    ...(turn === undefined ? {} : { turn }),
    ...(scope === undefined ? {} : { scope }),
    ...event,
  } as ClientStreamEvent;
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
  return event.type === "final" || event.type === "approval_required" || event.type === "error";
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
