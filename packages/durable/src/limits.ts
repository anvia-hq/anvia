import { DurableLimitError } from "./errors.js";
import type { DurableTransaction } from "./types.js";

/** Default byte budget for each persisted field (UTF-8 JSON). */
export const DEFAULT_PAYLOAD_BYTES = 1_048_576;

/** Budget groups that `maxPayloadBytes` can override separately. See `payloadBucket` for fields. */
export type DurablePayloadField = "prompt" | "operation" | "event" | "outcome";

/**
 * Per-field payload budgets. Each omitted group falls back to `default`, which itself defaults to
 * 1,048,576 bytes. The effective limits returned by `runtime.limits()` have every key filled in.
 */
export type DurablePayloadLimits = {
  default?: number;
  prompt?: number;
  operation?: number;
  event?: number;
  outcome?: number;
};

/** A single byte budget for every field, or per-field budgets. */
export type DurablePayloadBudget = number | DurablePayloadLimits;

export type DurableLimits = {
  maxPendingRuns: number;
  maxPendingTasks: number;
  maxPayloadBytes: DurablePayloadBudget;
  maxOperations: number;
};

const PAYLOAD_KEYS = ["default", "prompt", "operation", "event", "outcome"] as const;

export function durableLimits(input: Partial<DurableLimits> = {}): DurableLimits {
  const limits: DurableLimits = {
    maxPendingRuns: 10_000,
    maxPendingTasks: 10_000,
    maxPayloadBytes: DEFAULT_PAYLOAD_BYTES,
    maxOperations: 10_000,
    ...input,
  };
  for (const name of ["maxPendingRuns", "maxPendingTasks", "maxOperations"] as const)
    assertLimit(limits[name], name);
  limits.maxPayloadBytes = payloadBudget(limits.maxPayloadBytes);
  return limits;
}

/** Accepts a number (one budget for every field) or per-field overrides, and fills the gaps. */
function payloadBudget(value: unknown): DurablePayloadBudget {
  if (typeof value === "number") {
    assertLimit(value, "maxPayloadBytes");
    return value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid durable limit: maxPayloadBytes");
  for (const key of Object.keys(value))
    if (!(PAYLOAD_KEYS as readonly string[]).includes(key))
      throw new TypeError(`Invalid durable limit: maxPayloadBytes.${key}`);
  const given = value as DurablePayloadLimits;
  for (const key of PAYLOAD_KEYS) {
    if (given[key] !== undefined) assertLimit(given[key], `maxPayloadBytes.${key}`);
  }
  const fallback = given.default ?? DEFAULT_PAYLOAD_BYTES;
  return {
    default: fallback,
    prompt: given.prompt ?? fallback,
    operation: given.operation ?? fallback,
    event: given.event ?? fallback,
    outcome: given.outcome ?? fallback,
  };
}

function assertLimit(value: unknown, name: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError(`Invalid durable limit: ${name}`);
}

/**
 * Which budget group a persisted field counts against. Fields not listed here use `default`.
 * `run.input` is the submitted prompt plus inherited history, so it belongs with the prompt;
 * `run.history` is the settled conversation, so it belongs with the outcome.
 */
const FIELD_GROUPS: Readonly<Record<string, DurablePayloadField>> = {
  "run.prompt": "prompt",
  "run.input": "prompt",
  "run.history": "outcome",
  "run.outcome": "outcome",
  "task.outcome": "outcome",
  "operation.input": "operation",
  "operation.result": "operation",
  "event.model_delta": "event",
};

/** Effective byte limit for one persisted field. */
export function payloadLimitFor(budget: DurablePayloadBudget, field: string): number {
  if (typeof budget === "number") return budget;
  const group = FIELD_GROUPS[field];
  return group === undefined
    ? (budget.default ?? DEFAULT_PAYLOAD_BYTES)
    : (budget[group] ?? budget.default ?? DEFAULT_PAYLOAD_BYTES);
}

/** Runs inside the journal transaction; capacity decisions and writes are atomic. */
export function limitedTransaction(
  tx: DurableTransaction,
  limits: DurableLimits,
): DurableTransaction {
  // `serialized` is the JSON text of a value, already computed by the caller. Each field is
  // stringified at most once per write: the change check compares those strings, and the size
  // check measures the same string instead of serializing it again.
  const payload = (field: string, serialized: string | undefined) => {
    if (serialized === undefined) return;
    const limit = payloadLimitFor(limits.maxPayloadBytes, field);
    const actual = new TextEncoder().encode(serialized).byteLength;
    if (actual > limit)
      throw new DurableLimitError(
        "payload_too_large",
        `Durable payload byte limit exceeded: ${field} is ${actual} bytes; limit is ${limit} bytes.`,
        { field, limit, actual },
      );
  };
  const capacity = (kind: string, limit: number, count: number) =>
    new DurableLimitError(
      "capacity_exceeded",
      `Pending durable ${kind} limit reached: ${count} are unfinished; limit is ${limit}.`,
      { limit },
    );
  const terminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);
  // Each object is serialized at most once per check: the memo is keyed by identity, so the change
  // check and the size check of a value measure the same string.
  const texts = new WeakMap<object, string>();
  const textOf = (value: unknown): string | undefined => {
    if (typeof value !== "object" || value === null) return JSON.stringify(value);
    const known = texts.get(value);
    if (known !== undefined) return known;
    const text = JSON.stringify(value);
    if (text !== undefined) texts.set(value, text);
    return text;
  };
  /** Serialized `next` when it differs from `previous`, otherwise undefined (nothing to check). */
  const changed = (previous: unknown, next: unknown): string | undefined => {
    const nextText = textOf(next);
    return textOf(previous) === nextText ? undefined : nextText;
  };
  // `putBlob`/`getBlob` pass through unchecked by design: the blob table is the overflow area, and
  // the bounded reference that replaces the payload is what the checks below measure.
  return {
    ...tx,
    appendEvent(id, type, data) {
      if (type === "model_delta") payload("event.model_delta", textOf(data));
      // Status events are deliberately not checked. A status event is the only record of a
      // failure or a blocked run, and its `error` text is not checked anywhere else, so a limit
      // here would stop a run from reaching `failed` or `needs_attention` (the trap in DUR-03).
      // Their size is bounded by construction: no outcome, only ids, status and error text.
      tx.appendEvent(id, type, data);
    },
    putRun(run) {
      const previous = tx.getRun(run.id);
      if (!terminal(run.status) && (previous === undefined || terminal(previous.status))) {
        const pending = tx.pendingCounts().runs;
        if (pending >= limits.maxPendingRuns) throw capacity("run", limits.maxPendingRuns, pending);
      }
      if (previous === undefined) {
        payload("run.prompt", textOf(run.prompt));
        payload("run.trace", textOf(run.trace));
      }
      for (const key of [
        "input",
        "history",
        "responses",
        "steering",
        "outcome",
        "contextCheckpoint",
        "contextDocuments",
        "exhaustion",
      ] as const)
        payload(`run.${key}`, changed(previous?.[key], run[key]));
      tx.putRun(run);
    },
    putTask(task) {
      const previous = tx.getTask(task.id);
      if (!terminal(task.status) && (previous === undefined || terminal(previous.status))) {
        const pending = tx.pendingCounts().tasks;
        if (pending >= limits.maxPendingTasks)
          throw capacity("task", limits.maxPendingTasks, pending);
      }
      if (previous === undefined) payload("task.trace", textOf(task.trace));
      // Allow control/status transitions after limits are lowered on restart.
      for (const key of ["input", "checkpoint", "signals"] as const)
        payload(`task.${key}`, changed(previous?.[key], task[key]));
      // Owned-agent output was admitted with its run; copying it must survive lower quotas. Only the
      // output is measured, so its bytes are serialized once, not once inside the outcome as well.
      if (task.agentRunId === undefined && task.outcome?.status === "completed") {
        const output = textOf(task.outcome.output);
        const previousOutput =
          previous?.outcome?.status === "completed" ? previous.outcome.output : undefined;
        if (output !== textOf(previousOutput)) payload("task.outcome", output);
      }
      tx.putTask(task);
    },
    putOperation(id, operation) {
      const previous = tx.getOperation(id, operation.key);
      if (previous === undefined) {
        const count = tx.operationCount(id);
        if (count >= limits.maxOperations)
          throw new DurableLimitError(
            "capacity_exceeded",
            `Durable operation count limit reached: ${count} operations; limit is ${limits.maxOperations}.`,
            { limit: limits.maxOperations },
          );
      }
      payload("operation.input", changed(previous?.input, operation.input));
      payload("operation.result", changed(previous?.result, operation.result));
      tx.putOperation(id, operation);
    },
  };
}
