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
  const payload = (field: string, value: unknown) => {
    if (value === undefined) return;
    const actual = new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
  return {
    ...tx,
    appendEvent(id, type, data) {
      if (type === "model_delta") payload("event.model_delta", data);
      tx.appendEvent(id, type, data);
    },
    putRun(run) {
      const previous = tx.getRun(run.id);
      if (!terminal(run.status) && (previous === undefined || terminal(previous.status))) {
        const pending = tx.pendingCounts().runs;
        if (pending >= limits.maxPendingRuns) throw capacity("run", limits.maxPendingRuns, pending);
      }
      if (previous === undefined) {
        payload("run.prompt", run.prompt);
        payload("run.trace", run.trace);
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
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(run[key]))
          payload(`run.${key}`, run[key]);
      tx.putRun(run);
    },
    putTask(task) {
      const previous = tx.getTask(task.id);
      if (!terminal(task.status) && (previous === undefined || terminal(previous.status))) {
        const pending = tx.pendingCounts().tasks;
        if (pending >= limits.maxPendingTasks)
          throw capacity("task", limits.maxPendingTasks, pending);
      }
      if (previous === undefined) payload("task.trace", task.trace);
      // Allow control/status transitions after limits are lowered on restart.
      for (const key of ["input", "checkpoint", "signals"] as const)
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(task[key]))
          payload(`task.${key}`, task[key]);
      // Owned-agent output was admitted with its run; copying it must survive lower quotas.
      if (
        task.agentRunId === undefined &&
        task.outcome?.status === "completed" &&
        JSON.stringify(previous?.outcome) !== JSON.stringify(task.outcome)
      )
        payload("task.outcome", task.outcome.output);
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
      if (JSON.stringify(previous?.input) !== JSON.stringify(operation.input))
        payload("operation.input", operation.input);
      if (JSON.stringify(previous?.result) !== JSON.stringify(operation.result))
        payload("operation.result", operation.result);
      tx.putOperation(id, operation);
    },
  };
}
