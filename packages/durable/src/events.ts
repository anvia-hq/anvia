import type { JsonValue } from "@anvia/core/completion";
import type { DurableEvent } from "./types.js";

/**
 * What each event type carries, as written by the runtime. Fields that hold user or model content
 * (`input`, `result`, `event`, `prompt`) are `JsonValue`: large values are stored as blob
 * references, so read the run snapshot when you need the hydrated content.
 *
 * Run, graph and task events share the stream, so `submitted` and `status` have more than one
 * shape. Every field a shape does not always set is optional; narrow on the fields you read.
 * Unknown future fields may appear: treat payloads as open.
 */
export type DurableEventPayloads = {
  /** A run was submitted (`agentId`, `sessionId`, `requestId`, `prompt`) or created for a graph or task. */
  submitted: {
    agentId?: string;
    sessionId?: string;
    requestId?: string;
    prompt?: JsonValue;
    graphId?: string;
    taskId?: string;
    /** Task events: the task's name and tree. */
    name?: string;
    parentId?: string;
    rootId?: string;
  };
  /** A status transition. Task events add `wait` and `outcome`; a graph cancel sets `graphCancelled`. */
  status: {
    status?: string;
    error?: string;
    blockedOperation?: string;
    nextAttemptAt?: string;
    wait?: JsonValue;
    outcome?: JsonValue;
    graphCancelled?: boolean;
  };
  steering_queued: { id: string };
  steering_applied: { id: string; epoch: number; turn: number };
  model_started: { operationId: string; input: JsonValue };
  model_attempt_started: { operationId: string; attemptId: string; attempt: number };
  /** One streamed model event of an attempt. */
  model_delta: { operationId: string; attemptId?: string; event: JsonValue };
  model_attempt_failed: {
    operationId: string;
    attemptId: string;
    failureKind: "model" | "local";
    error: string;
  };
  model_completed: { operationId: string; attemptId?: string; result: JsonValue };
  tool_started: { operationId: string; input: JsonValue };
  /** `reconciled` is true when an operator supplied the result (`resolveTool`). */
  tool_completed: {
    operationId: string;
    attemptId?: string;
    result: JsonValue;
    reconciled?: boolean;
  };
  compaction_started: { operationId: string; turn?: number; epoch?: number };
  compaction_completed: {
    operationId: string;
    turn?: number;
    epoch?: number;
    originalMessageCount: number;
    compactedMessageCount: number;
    retainedMessageCount: number;
    originalTokenCount: number;
    compactedTokenCount: number;
    retainedTokenCount: number;
    resultTokenCount: number;
    attempts: number;
    usage: JsonValue;
  };
};

export type DurableEventType = DurableEvent["type"];

/** A `DurableEvent` narrowed to one type, with its payload typed. */
export type DurableEventOf<Type extends DurableEventType = DurableEventType> = {
  [K in Type]: Omit<DurableEvent, "type" | "data"> & { type: K; data: DurableEventPayloads[K] };
}[Type];

/**
 * Narrows an event by type. It checks the type tag only, not the payload, which is written by the
 * runtime; the payload types document that contract.
 *
 * ```ts
 * for await (const event of run.stream())
 *   if (isDurableEvent(event, "model_delta")) render(event.data.event);
 * ```
 */
export function isDurableEvent<Type extends DurableEventType>(
  event: DurableEvent,
  ...types: [Type, ...Type[]]
): event is DurableEvent & DurableEventOf<Type> {
  return (types as readonly string[]).includes(event.type);
}
