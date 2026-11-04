import { DurableLimitError } from "./errors.js";
import type { DurableTransaction } from "./types.js";

export type DurableLimits = {
  maxPendingRuns: number;
  maxPendingTasks: number;
  maxPayloadBytes: number;
  maxOperations: number;
};
export function durableLimits(input: Partial<DurableLimits> = {}): DurableLimits {
  const limits = {
    maxPendingRuns: 10_000,
    maxPendingTasks: 10_000,
    maxPayloadBytes: 1_048_576,
    maxOperations: 10_000,
    ...input,
  };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError(`Invalid durable limit: ${name}`);
  return limits;
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
    const actual = new TextEncoder().encode(serialized).byteLength;
    if (actual > limits.maxPayloadBytes)
      throw new DurableLimitError(
        "payload_too_large",
        `Durable payload byte limit exceeded: ${field} is ${actual} bytes; limit is ${limits.maxPayloadBytes} bytes.`,
        { field, limit: limits.maxPayloadBytes, actual },
      );
  };
  const capacity = (kind: string, limit: number, count: number) =>
    new DurableLimitError(
      "capacity_exceeded",
      `Pending durable ${kind} limit reached: ${count} are unfinished; limit is ${limit}.`,
      { limit },
    );
  const terminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);
  /** Serialized `next` when it differs from `previous`, otherwise undefined (nothing to check). */
  const changed = (previous: unknown, next: unknown): string | undefined => {
    const nextText = JSON.stringify(next);
    return JSON.stringify(previous) === nextText ? undefined : nextText;
  };
  return {
    ...tx,
    appendEvent(id, type, data) {
      if (type === "model_delta") payload("event.model_delta", JSON.stringify(data));
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
        payload("run.prompt", JSON.stringify(run.prompt));
        payload("run.trace", JSON.stringify(run.trace));
      }
      for (const key of [
        "input",
        "history",
        "responses",
        "steering",
        "outcome",
        "contextCheckpoint",
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
      if (previous === undefined) payload("task.trace", JSON.stringify(task.trace));
      // Allow control/status transitions after limits are lowered on restart.
      for (const key of ["input", "checkpoint", "signals"] as const)
        payload(`task.${key}`, changed(previous?.[key], task[key]));
      // Owned-agent output was admitted with its run; copying it must survive lower quotas.
      if (
        task.agentRunId === undefined &&
        task.outcome?.status === "completed" &&
        changed(previous?.outcome, task.outcome) !== undefined
      )
        payload("task.outcome", JSON.stringify(task.outcome.output));
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
