import type { AgentInteractionRequest } from "@anvia/core/agent/interactions";
import type {
  AssistantContentPart,
  ContextUsage,
  JsonObject,
  JsonValue,
  ProviderToolCall,
  ReasoningContentType,
  ReasoningDetail,
  ToolCallPart,
  ToolResultContentPart,
  ToolResultOutput,
  Usage,
} from "@anvia/core/completion";
import { isJsonValue } from "@anvia/core/completion";
import type { CompletionSource } from "@anvia/core/completion";
import type { MemoryCompactionInfo } from "@anvia/core/memory";
import type { DurableEvent } from "@anvia/durable/protocol";
import type { ClientStreamError, ClientStreamEvent } from "./types";

/**
 * Pure projection from durable journal events to `anvia.client.v3` stream events.
 *
 * Durable `sequence` values are a global autoincrement across every run in the store, so they
 * are not contiguous inside one chat stream. `validateFrameSequence` (client-transport.ts)
 * requires each `eventId` to be exactly `last + 1` and would reject a replay, a resume cursor,
 * or any stream that shares the database with other runs. This mapper therefore uses the durable
 * sequence itself as the event id, which is also the cursor `stream({ after })` expects. Callers
 * must not wrap the resulting frames in the standard contiguous frame validator.
 *
 * Message and part ids are synthesized as `${runId}:${operationId}:${attemptId}` plus a part
 * suffix. Replaying the same journal on reconnect assigns the same identities.
 */
export type DurableChatMapState = {
  /** Assistant message open for the model operation currently streaming. */
  messageId?: string | undefined;
  /** Attempt id of the open message. Part ids include it; the message id does not. */
  attemptId?: string | undefined;
  /** Last durable sequence applied. The next resume starts after this cursor. */
  sequence: number;
  /** Model operations that already opened a message, so a later attempt resets it. */
  openedOperations: Set<string>;
  /** Parts that already emitted their `*_start`, so a replay of one event does not repeat it. */
  openedParts: Set<string>;
  /** True once `run_start` has been emitted for this projection. */
  runOpened: boolean;
};

/** `Omit` over a union collapses to common keys; this distributes over every event variant. */
type WithoutRunId<T> = T extends unknown ? Omit<T, "runId"> : never;

export function createDurableChatMapState(sequence = 0): DurableChatMapState {
  return { sequence, openedOperations: new Set(), openedParts: new Set(), runOpened: false };
}

export type DurableChatMapped = {
  events: readonly ClientStreamEvent[];
  state: DurableChatMapState;
};

/**
 * Map one durable event. Events at or before the applied cursor produce nothing, so a reconnect
 * that overlaps the stored sequence does not double-apply.
 */
export function mapDurableChatEvent(
  event: DurableEvent,
  state: DurableChatMapState,
): DurableChatMapped {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.sequence) {
    return { events: [], state };
  }
  const draft = fork(state, event.sequence);
  const events = project(event, draft);
  return { events, state: draft };
}

/** `${runId}:${operationId}:${attemptId}` — stable across reconnects for one model attempt. */
export function durableChatMessageId(
  runId: string,
  operationId: string,
  attemptId: string,
): string {
  return `${runId}:${operationId}:${attemptId}`;
}

function project(event: DurableEvent, state: DurableChatMapState): ClientStreamEvent[] {
  const data = asRecord(event.data);
  switch (event.type) {
    case "submitted":
      return openRun(event.runId, state);
    case "status":
      return mapStatus(event, data, state);
    case "model_started":
      return mapModelStarted(event, data, state);
    case "model_attempt_started":
      return mapAttemptStarted(event, data, state);
    case "model_delta":
      return mapModelDelta(event, data, state);
    case "model_attempt_failed":
      return mapAttemptFailed(event, data, state);
    case "model_completed":
      return mapModelCompleted(event, data, state);
    case "tool_started":
      return mapToolStarted(event, data, state);
    case "tool_completed":
      return mapToolCompleted(event, data, state);
    case "compaction_completed":
      return mapCompaction(event, data);
    case "steering_queued":
    case "steering_applied":
      return [
        located(event, { type: "data", name: event.type, data: data ?? {}, transient: true }),
      ];
    default:
      return [];
  }
}

function mapStatus(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const status = text(data, "status");
  if (status === "needs_attention") return needsAttention(event, data);
  if (status === "failed") return failed(event, data);
  if (status === "cancelled") return [located(event, { type: "run_end", status: "cancelled" })];
  if (status === "waiting" || status === "completed") return settled(event, data, status);
  // The first non-terminal status stands in for `submitted` when a replay starts mid-journal.
  if (!state.runOpened && (status === "queued" || status === "pending" || status === "running")) {
    return openRun(event.runId, state);
  }
  return [];
}

function openRun(runId: string, state: DurableChatMapState): ClientStreamEvent[] {
  state.runOpened = true;
  const messageId = `${runId}:assistant:pending`;
  state.messageId = messageId;
  return [
    { type: "run_start", source: "agent", runId },
    { type: "message_start", messageId, role: "assistant", runId },
  ];
}

function mapModelStarted(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const operationId = text(data, "operationId") ?? "model";
  const messageId = durableChatMessageId(event.runId, operationId, "1");
  state.openedOperations.add(operationId);
  state.messageId = messageId;
  const generation: ClientStreamEvent = { type: "generation_start", runId: event.runId };
  const model = modelOf(data);
  if (model !== undefined) generation.model = model;
  // `run_start` belongs to submitted / the first status. Repeat it only when this event is the
  // first one the projection has seen, so a normal journal does not open the run twice.
  const events: ClientStreamEvent[] = [];
  if (!state.runOpened) events.push({ type: "run_start", source: "agent", runId: event.runId });
  state.runOpened = true;
  events.push({ type: "turn_start", runId: event.runId }, generation, {
    type: "message_start",
    messageId,
    role: "assistant",
    runId: event.runId,
  });
  return events;
}

function mapAttemptStarted(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const operationId = text(data, "operationId");
  if (operationId === undefined) return [];
  const attemptId = text(data, "attemptId") ?? String(number(data, "attempt") ?? 1);
  const attempt = number(data, "attempt");
  const messageId = durableChatMessageId(event.runId, operationId, attemptId);
  const retried = state.openedOperations.has(operationId) && (attempt === undefined || attempt > 1);
  const events: ClientStreamEvent[] = [];
  if (retried && state.messageId !== undefined) {
    // Discard the partial attempt but keep the message identity the reducer already holds.
    events.push({ type: "message_reset", messageId: state.messageId, runId: event.runId });
  } else {
    events.push({ type: "message_start", messageId, role: "assistant", runId: event.runId });
  }
  state.openedOperations.add(operationId);
  state.messageId = messageId;
  return events;
}

function mapModelDelta(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const nested = asRecord(data?.event);
  const kind = text(nested, "type");
  if (nested === undefined || kind === undefined) return [];
  const operationId = text(data, "operationId") ?? "model";
  const attemptId = text(data, "attemptId") ?? "1";
  const messageId = state.messageId ?? durableChatMessageId(event.runId, operationId, attemptId);
  state.messageId = messageId;
  const turn = number(nested, "turn");

  if (kind === "text_delta") {
    const delta = text(nested, "delta");
    if (delta === undefined) return [];
    return withStart(state, messageId, "text", undefined, event.runId, turn, (partId, started) => {
      const events: ClientStreamEvent[] = [];
      if (!started) events.push(part(event.runId, turn, { type: "text_start", messageId, partId }));
      events.push(part(event.runId, turn, { type: "text_delta", messageId, partId, delta }));
      return events;
    });
  }

  if (kind === "reasoning_delta") {
    const delta = text(nested, "delta");
    if (delta === undefined) return [];
    const reasoningId = text(nested, "id");
    return withStart(
      state,
      messageId,
      "reasoning",
      reasoningId ?? "default",
      event.runId,
      turn,
      (partId, started) => {
        const events: ClientStreamEvent[] = [];
        if (!started) {
          const start = part(event.runId, turn, { type: "reasoning_start", messageId, partId });
          if (reasoningId !== undefined && start.type === "reasoning_start") {
            start.reasoningId = reasoningId;
          }
          events.push(start);
        }
        const deltaEvent = part(event.runId, turn, {
          type: "reasoning_delta",
          messageId,
          partId,
          delta,
        });
        const contentType = reasoningType(text(nested, "contentType"));
        const signature = text(nested, "signature");
        if (deltaEvent.type === "reasoning_delta") {
          if (contentType !== undefined) deltaEvent.contentType = contentType;
          if (signature !== undefined) deltaEvent.signature = signature;
        }
        events.push(deltaEvent);
        return events;
      },
    );
  }

  if (kind === "tool_call_delta") {
    const toolCallId = text(nested, "id");
    if (toolCallId === undefined) return [];
    return withStart(state, messageId, "tool", toolCallId, event.runId, turn, (partId, started) => {
      const events: ClientStreamEvent[] = [];
      const callId = text(nested, "callId");
      const toolName = text(nested, "name");
      if (!started) {
        const start = part(event.runId, turn, {
          type: "tool_call_start",
          messageId,
          partId,
          toolCallId,
        });
        if (start.type === "tool_call_start") {
          if (callId !== undefined) start.callId = callId;
          if (toolName !== undefined) start.toolName = toolName;
        }
        events.push(start);
      }
      const delta = text(nested, "argumentsDelta");
      if (delta === undefined) return events;
      const tool = part(event.runId, turn, {
        type: "tool_call_delta",
        messageId,
        partId,
        toolCallId,
        delta,
        mode: nested.argumentsMode === "replace" ? "replace" : "append",
      });
      if (tool.type === "tool_call_delta") {
        if (callId !== undefined) tool.callId = callId;
        if (toolName !== undefined) tool.toolName = toolName;
        const signature = text(nested, "signature");
        if (signature !== undefined) tool.signature = signature;
      }
      events.push(tool);
      return events;
    });
  }

  if (kind === "tool_call") {
    const call = asToolCall(nested.toolCall);
    return call === undefined ? [] : [toolCallEnd(event.runId, messageId, call, turn)];
  }
  if (kind === "source") {
    const source = asSource(nested.source);
    if (source === undefined) return [];
    return [
      part(event.runId, turn, {
        type: "source",
        messageId,
        partId: partId(messageId, "source", JSON.stringify(source)),
        source,
      }),
    ];
  }
  if (kind === "provider_tool_call") {
    const toolCall = asProviderToolCall(nested.toolCall);
    return toolCall === undefined
      ? []
      : [part(event.runId, turn, { type: "provider_tool_call", toolCall })];
  }
  return [];
}

function mapAttemptFailed(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const operationId = text(data, "operationId");
  // `retry_wait` may follow, so the message stays open for the next attempt.
  const details: JsonObject = {};
  if (operationId !== undefined) details.operationId = operationId;
  if (state.messageId !== undefined) details.messageId = state.messageId;
  const error: ClientStreamError = {
    name: "DurableModelAttemptError",
    message: text(data, "error") ?? "Durable model attempt failed.",
    retryable: true,
  };
  if (Object.keys(details).length > 0) error.details = details;
  return [located(event, { type: "error", error })];
}

function mapModelCompleted(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const operationId = text(data, "operationId") ?? "model";
  const attemptId = text(data, "attemptId") ?? "1";
  const messageId = state.messageId ?? durableChatMessageId(event.runId, operationId, attemptId);
  state.messageId = messageId;
  const result = asRecord(data?.result);
  const choice = assistantParts(result?.choice);
  const events: ClientStreamEvent[] = [];
  const texts = choice.filter((part) => part.type === "text");
  const textJoined = texts.map((part) => part.text).join("");
  const textPartId = partId(messageId, "text");
  if (textJoined.length > 0 || state.openedParts.has(textPartId)) {
    if (!state.openedParts.has(textPartId)) {
      state.openedParts.add(textPartId);
      events.push({ type: "text_start", messageId, partId: textPartId, runId: event.runId });
    }
    const end: ClientStreamEvent = {
      type: "text_end",
      messageId,
      partId: textPartId,
      text: textJoined,
      runId: event.runId,
    };
    const signature = texts.length === 1 ? texts[0]?.signature : undefined;
    if (signature !== undefined && end.type === "text_end") end.signature = signature;
    events.push(end);
  }
  for (const content of choice) {
    if (content.type === "reasoning")
      events.push(reasoningEnd(event.runId, messageId, content, state));
    if (content.type === "tool-call") events.push(toolCallEnd(event.runId, messageId, content));
  }
  const messageEnd: ClientStreamEvent = { type: "message_end", messageId, runId: event.runId };
  const usage = asUsage(result?.usage);
  const contextUsage = asContextUsage(result?.contextUsage);
  if (usage !== undefined && messageEnd.type === "message_end") messageEnd.usage = usage;
  if (contextUsage !== undefined && messageEnd.type === "message_end") {
    messageEnd.contextUsage = contextUsage;
  }
  if (typeof result?.messageId === "string" && messageEnd.type === "message_end") {
    messageEnd.modelMessageId = result.messageId;
  }
  events.push(messageEnd);
  return events;
}

function mapToolStarted(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const call = asToolCall(asRecord(data?.input)?.toolCall);
  if (call === undefined) return [];
  const messageId = state.messageId ?? durableChatMessageId(event.runId, "tools", "1");
  return [toolCallEnd(event.runId, messageId, call)];
}

function mapToolCompleted(
  event: DurableEvent,
  data: JsonObject | undefined,
  state: DurableChatMapState,
): ClientStreamEvent[] {
  const call = asToolCall(asRecord(data?.input)?.toolCall);
  const saved = asRecord(data?.result);
  const output = asToolOutput(saved?.output);
  if (output === undefined) return [];
  const messageId = state.messageId ?? durableChatMessageId(event.runId, "tools", "1");
  const toolCallId = call?.toolCallId ?? text(data, "operationId") ?? "tool";
  const failed = saved?.failed === true;
  const result: ClientStreamEvent = {
    type: "tool_result",
    messageId,
    partId: partId(messageId, "tool", toolCallId),
    toolCallId,
    toolName: call?.toolName ?? "tool",
    input: call?.input ?? null,
    runId: event.runId,
    result: failed
      ? {
          status: "error",
          error: { message: text(saved, "error") ?? "Tool failed.", retryable: false },
        }
      : { status: "success", output: toolOutputValue(output) },
  };
  if (call?.callId !== undefined && result.type === "tool_result") result.callId = call.callId;
  return [result];
}

function mapCompaction(event: DurableEvent, data: JsonObject | undefined): ClientStreamEvent[] {
  const info = asCompaction(data);
  return info === undefined ? [] : [located(event, { type: "memory_compaction", ...info })];
}

function needsAttention(event: DurableEvent, data: JsonObject | undefined): ClientStreamEvent[] {
  const operationId = text(data, "blockedOperation");
  const details: JsonObject = { retryable: true };
  if (operationId !== undefined) details.operationId = operationId;
  return [
    located(event, {
      type: "error",
      error: {
        name: "DurableNeedsAttention",
        message: text(data, "error") ?? "Durable run needs attention.",
        code: "needs_attention",
        retryable: true,
        details,
      },
    }),
    located(event, { type: "run_end", status: "error" }),
  ];
}

function failed(event: DurableEvent, data: JsonObject | undefined): ClientStreamEvent[] {
  const outcome = asRecord(data?.outcome);
  const error = located(event, {
    type: "error",
    error: {
      name: "DurableRunError",
      message: text(data, "error") ?? "Durable run failed.",
      code: "failed",
      retryable: false,
    },
  });
  const usage = asUsage(outcome?.usage);
  if (usage !== undefined && error.type === "error") error.usage = usage;
  return [error, runEnd(event, outcome, "error")];
}

function settled(
  event: DurableEvent,
  data: JsonObject | undefined,
  status: "waiting" | "completed",
): ClientStreamEvent[] {
  const outcome = asRecord(data?.outcome);
  const outcomeType = text(outcome, "type");
  if (status === "waiting" || outcomeType === "interaction") {
    const interaction = asInteraction(outcome?.interaction);
    const events: ClientStreamEvent[] = [];
    if (interaction !== undefined)
      events.push(located(event, { type: "interaction", interaction }));
    events.push(runEnd(event, outcome, "suspended"));
    return events;
  }
  if (outcomeType === "blocked") return [runEnd(event, outcome, "blocked")];
  return [runEnd(event, outcome, "completed")];
}

function runEnd(
  event: DurableEvent,
  outcome: JsonObject | undefined,
  status: "completed" | "blocked" | "suspended" | "error",
): ClientStreamEvent {
  const end = located(event, { type: "run_end", status });
  if (end.type !== "run_end") return end;
  const value = text(outcome, "text");
  const usage = asUsage(outcome?.usage);
  const contextUsage = asContextUsage(outcome?.contextUsage);
  const trace = asTrace(outcome?.trace);
  const compaction = asCompaction(asRecord(outcome?.memoryCompaction));
  if (value !== undefined) end.text = value;
  if (outcome?.output !== undefined && isJsonValue(outcome.output)) end.output = outcome.output;
  if (usage !== undefined) end.usage = usage;
  if (contextUsage !== undefined) end.contextUsage = contextUsage;
  if (trace !== undefined) end.trace = trace;
  if (compaction !== undefined) end.memoryCompaction = compaction;
  return end;
}

function reasoningEnd(
  runId: string,
  messageId: string,
  content: Extract<AssistantContentPart, { type: "reasoning" }>,
  state: DurableChatMapState,
): ClientStreamEvent {
  const id = partId(messageId, "reasoning", content.id ?? "default");
  const end: ClientStreamEvent = {
    type: "reasoning_end",
    messageId,
    partId: id,
    text: content.text,
    runId,
  };
  if (!state.openedParts.has(id)) state.openedParts.add(id);
  if (content.details !== undefined && end.type === "reasoning_end") end.content = content.details;
  return end;
}

function toolCallEnd(
  runId: string,
  messageId: string,
  call: ToolCallPart,
  turn?: number,
): ClientStreamEvent {
  const event = part(runId, turn, {
    type: "tool_call_end",
    messageId,
    partId: partId(messageId, "tool", call.toolCallId),
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
  });
  if (event.type !== "tool_call_end") return event;
  if (call.callId !== undefined) event.callId = call.callId;
  if (call.signature !== undefined) event.signature = call.signature;
  return event;
}

function withStart(
  state: DurableChatMapState,
  messageId: string,
  kind: string,
  suffix: string | undefined,
  runId: string,
  turn: number | undefined,
  build: (partId: string, started: boolean) => ClientStreamEvent[],
): ClientStreamEvent[] {
  void runId;
  void turn;
  const id = partId(messageId, kind, suffix);
  const started = state.openedParts.has(id);
  if (!started) state.openedParts.add(id);
  return build(id, started);
}

function part(
  runId: string,
  turn: number | undefined,
  event: WithoutRunId<ClientStreamEvent>,
): ClientStreamEvent {
  const locatedEvent = { ...event, runId } as ClientStreamEvent;
  if (turn !== undefined && "turn" in locatedEvent) locatedEvent.turn = turn;
  else if (turn !== undefined) return { ...locatedEvent, turn };
  return locatedEvent;
}

function located(event: DurableEvent, fields: WithoutRunId<ClientStreamEvent>): ClientStreamEvent {
  return { ...fields, runId: event.runId } as ClientStreamEvent;
}

function fork(state: DurableChatMapState, sequence: number): DurableChatMapState {
  return {
    messageId: state.messageId,
    sequence,
    openedOperations: new Set(state.openedOperations),
    openedParts: new Set(state.openedParts),
    runOpened: state.runOpened,
  };
}

function partId(messageId: string, kind: string, suffix?: string): string {
  return suffix === undefined ? `${messageId}:${kind}` : `${messageId}:${kind}:${suffix}`;
}

function asRecord(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function text(value: JsonObject | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function number(value: JsonObject | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function modelOf(data: JsonObject | undefined): { provider: string; modelId: string } | undefined {
  const input = asRecord(data?.input);
  const provider = text(input, "provider");
  const modelId = text(input, "modelId");
  return provider === undefined || modelId === undefined ? undefined : { provider, modelId };
}

const REASONING: readonly ReasoningContentType[] = ["text", "summary", "encrypted", "redacted"];

function reasoningType(value: string | undefined): ReasoningContentType | undefined {
  return REASONING.find((type) => type === value);
}

function asToolCall(value: unknown): ToolCallPart | undefined {
  const call = asRecord(value);
  if (call?.type !== "tool-call") return undefined;
  const toolCallId = text(call, "toolCallId");
  const toolName = text(call, "toolName");
  if (toolCallId === undefined || toolName === undefined || !isJsonValue(call.input))
    return undefined;
  const parsed: ToolCallPart = { type: "tool-call", toolCallId, toolName, input: call.input };
  const callId = text(call, "callId");
  const signature = text(call, "signature");
  if (callId === undefined) {
    return signature === undefined ? parsed : { ...parsed, signature };
  }
  if (signature === undefined) return { ...parsed, callId };
  return { ...parsed, callId, signature };
}

function asSource(value: unknown): CompletionSource | undefined {
  return asRecord(value) as CompletionSource | undefined;
}

function asProviderToolCall(value: unknown): ProviderToolCall | undefined {
  const call = asRecord(value);
  return call === undefined ? undefined : (call as ProviderToolCall);
}

function assistantParts(value: unknown): AssistantContentPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const part = assistantPart(item);
    return part === undefined ? [] : [part];
  });
}

function assistantPart(value: unknown): AssistantContentPart | undefined {
  const part = asRecord(value);
  const type = text(part, "type");
  if (part === undefined || type === undefined) return undefined;
  if (type === "text" && typeof part.text === "string") {
    return typeof part.signature === "string"
      ? { type: "text", text: part.text, signature: part.signature }
      : { type: "text", text: part.text };
  }
  if (type === "reasoning" && typeof part.text === "string") {
    const details = asReasoningDetails(part.details);
    const base = { type: "reasoning" as const, text: part.text };
    if (typeof part.id !== "string") return details === undefined ? base : { ...base, details };
    return details === undefined ? { ...base, id: part.id } : { ...base, id: part.id, details };
  }
  if (type === "tool-call") return asToolCall(part);
  return undefined;
}

function asReasoningDetails(value: unknown): readonly ReasoningDetail[] | undefined {
  if (!Array.isArray(value) || !isJsonValue(value)) return undefined;
  return value as readonly ReasoningDetail[];
}

function asUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (usage === undefined) return undefined;
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
  ] as const;
  const counts: Partial<Usage> = {};
  for (const key of keys) {
    const count = number(usage, key);
    if (count === undefined) return undefined;
    counts[key] = count;
  }
  const parsed = counts as Usage;
  const details = asRecord(usage.details);
  if (details !== undefined && Object.values(details).every((item) => typeof item === "number")) {
    parsed.details = details as Record<string, number>;
  }
  return parsed;
}

function asContextUsage(value: unknown): ContextUsage | undefined {
  const usage = asRecord(value);
  const model = asRecord(usage?.model);
  const context = asRecord(model?.context);
  if (usage === undefined || typeof model?.modelId !== "string" || context === undefined)
    return undefined;
  const contextWindow = number(context, "contextWindow");
  const usedTokens = number(usage, "usedTokens");
  const remainingTokens = number(usage, "remainingTokens");
  const usedPercent = number(usage, "usedPercent");
  const remainingPercent = number(usage, "remainingPercent");
  if (
    contextWindow === undefined ||
    usedTokens === undefined ||
    remainingTokens === undefined ||
    usedPercent === undefined ||
    remainingPercent === undefined
  ) {
    return undefined;
  }
  const parsed: ContextUsage = {
    model: { modelId: model.modelId, context: { contextWindow } },
    usedTokens,
    remainingTokens,
    usedPercent,
    remainingPercent,
  };
  const maxInputTokens = number(context, "maxInputTokens");
  const maxOutputTokens = number(context, "maxOutputTokens");
  if (maxInputTokens !== undefined) parsed.model.context.maxInputTokens = maxInputTokens;
  if (maxOutputTokens !== undefined) parsed.model.context.maxOutputTokens = maxOutputTokens;
  return parsed;
}

function asTrace(
  value: unknown,
): { observer: string; traceId?: string; observationId?: string } | undefined {
  const trace = asRecord(value);
  const observer = text(trace, "observer");
  if (observer === undefined) return undefined;
  const parsed: { observer: string; traceId?: string; observationId?: string } = { observer };
  const traceId = text(trace, "traceId");
  const observationId = text(trace, "observationId");
  if (traceId !== undefined) parsed.traceId = traceId;
  if (observationId !== undefined) parsed.observationId = observationId;
  return parsed;
}

function asCompaction(value: JsonObject | undefined): MemoryCompactionInfo | undefined {
  if (value === undefined) return undefined;
  const keys = [
    "originalMessageCount",
    "compactedMessageCount",
    "retainedMessageCount",
    "originalTokenCount",
    "compactedTokenCount",
    "retainedTokenCount",
    "resultTokenCount",
    "attempts",
  ] as const;
  const info: Partial<Record<(typeof keys)[number], number>> = {};
  for (const key of keys) {
    const count = number(value, key);
    if (count === undefined) return undefined;
    info[key] = count;
  }
  const usage = asUsage(value.usage);
  if (usage === undefined) return undefined;
  return { ...(info as Omit<MemoryCompactionInfo, "usage">), usage };
}

function asInteraction(value: unknown): AgentInteractionRequest | undefined {
  const request = asRecord(value);
  const type = text(request, "type");
  const id = text(request, "id");
  const toolName = text(request, "toolName");
  const toolCallId = text(request, "toolCallId");
  const internalCallId = text(request, "internalCallId");
  if (
    request === undefined ||
    id === undefined ||
    toolName === undefined ||
    toolCallId === undefined ||
    internalCallId === undefined
  ) {
    return undefined;
  }
  const callId = text(request, "callId");
  const base: {
    id: string;
    toolName: string;
    toolCallId: string;
    internalCallId: string;
    callId?: string;
  } = { id, toolName, toolCallId, internalCallId };
  if (callId !== undefined) base.callId = callId;
  if (type === "tool-approval" && isJsonValue(request.input)) {
    const approval = { ...base, type: "tool-approval" as const, input: request.input };
    const reason = text(request, "reason");
    return reason === undefined ? approval : { ...approval, reason };
  }
  if (
    type === "tool-question" &&
    Array.isArray(request.questions) &&
    isJsonValue(request.questions)
  ) {
    return {
      ...base,
      type,
      questions: request.questions as Extract<
        AgentInteractionRequest,
        { type: "tool-question" }
      >["questions"],
    };
  }
  return undefined;
}

function asToolOutput(value: unknown): ToolResultOutput | undefined {
  const output = asRecord(value);
  const type = text(output, "type");
  if (output === undefined || type === undefined) return undefined;
  if ((type === "text" || type === "error-text") && typeof output.value === "string") {
    return { type, value: output.value };
  }
  if ((type === "json" || type === "error-json") && isJsonValue(output.value)) {
    return { type, value: output.value };
  }
  if (type === "execution-denied") {
    const reason = text(output, "reason");
    return reason === undefined ? { type } : { type, reason };
  }
  if (type === "content" && Array.isArray(output.value) && isJsonValue(output.value)) {
    return { type, value: output.value as readonly ToolResultContentPart[] };
  }
  return undefined;
}

function toolOutputValue(output: ToolResultOutput): JsonValue {
  if (output.type === "execution-denied") {
    return output.reason === undefined
      ? { type: output.type }
      : { type: output.type, reason: output.reason };
  }
  return output.value as JsonValue;
}
