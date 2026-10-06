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
  const payload = (value: unknown) => {
    if (
      value !== undefined &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.maxPayloadBytes
    )
      throw new DurableLimitError("Durable payload byte limit exceeded.");
  };
  const terminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);
  return {
    ...tx,
    appendEvent(id, type, data) {
      if (type === "model_delta") payload(data);
      tx.appendEvent(id, type, data);
    },
    putRun(run) {
      const previous = tx.getRun(run.id);
      if (
        !terminal(run.status) &&
        (previous === undefined || terminal(previous.status)) &&
        tx.pendingCounts().runs >= limits.maxPendingRuns
      )
        throw new DurableLimitError("Pending durable run limit reached.");
      if (previous === undefined) payload(run.prompt);
      for (const key of ["input", "history", "responses", "outcome"] as const)
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(run[key])) payload(run[key]);
      tx.putRun(run);
    },
    putTask(task) {
      const previous = tx.getTask(task.id);
      if (
        !terminal(task.status) &&
        (previous === undefined || terminal(previous.status)) &&
        tx.pendingCounts().tasks >= limits.maxPendingTasks
      )
        throw new DurableLimitError("Pending durable task limit reached.");
      // Allow control/status transitions after limits are lowered on restart.
      for (const key of ["input", "checkpoint", "signals"] as const)
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(task[key])) payload(task[key]);
      // Owned-agent output was admitted with its run; copying it must survive lower quotas.
      if (
        task.agentRunId === undefined &&
        task.outcome?.status === "completed" &&
        JSON.stringify(previous?.outcome) !== JSON.stringify(task.outcome)
      )
        payload(task.outcome.output);
      tx.putTask(task);
    },
    putOperation(id, operation) {
      const previous = tx.getOperation(id, operation.key);
      if (previous === undefined && tx.operationCount(id) >= limits.maxOperations)
        throw new DurableLimitError("Durable operation count limit reached.");
      if (JSON.stringify(previous?.input) !== JSON.stringify(operation.input))
        payload(operation.input);
      if (JSON.stringify(previous?.result) !== JSON.stringify(operation.result))
        payload(operation.result);
      tx.putOperation(id, operation);
    },
  };
}
