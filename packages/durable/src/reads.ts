import { hydrateValue } from "./blob.js";
import { DurableNotFoundError } from "./errors.js";
import { requireGraph } from "./graph-state.js";
import { json } from "./json.js";
import { TASK_SESSION_PREFIX } from "./tasks/agent.js";
import type {
  DurableEvent,
  DurableOperation,
  DurableRunRecord,
  DurableRunScope,
  DurableRunSummary,
  DurableSnapshot,
  DurableStore,
  DurableTransaction,
  DurableTransactionOptions,
} from "./types.js";

/** Run reads shared by the owning runtime and the read-only observer. None of them write. */

const READ_ONLY: DurableTransactionOptions = { readOnly: true };

async function requireRun(tx: DurableTransaction, id: string): Promise<DurableRunRecord> {
  const run = await tx.getRun(id);
  if (run === undefined) throw new DurableNotFoundError(`Unknown durable run: ${id}`);
  return run;
}

export function readRun(store: DurableStore, id: string): Promise<DurableRunRecord> {
  return store.transaction(async (tx) => {
    const stored = await requireRun(tx, id);
    return (await tx.blobs((io) => hydrateValue(io, json(stored)))) as DurableRunRecord;
  }, READ_ONLY);
}

export function readStatus(store: DurableStore, id: string): Promise<DurableRunSummary> {
  return store.transaction(async (tx) => {
    const summary = await tx.getRunSummary(id);
    if (summary === undefined) throw new DurableNotFoundError("Durable run not found.");
    return summary;
  }, READ_ONLY);
}

export function readSnapshot(
  store: DurableStore,
  id: string,
  options: { operations?: boolean } = {},
): Promise<DurableSnapshot> {
  return store.transaction(async (tx) => {
    const stored = await requireRun(tx, id);
    const run = (await tx.blobs((io) => hydrateValue(io, json(stored)))) as DurableRunRecord;
    const operations: DurableOperation[] = [];
    if (options.operations !== false)
      for (const operation of await tx.operations(id))
        operations.push(
          (await tx.blobs((io) => hydrateValue(io, json(operation)))) as DurableOperation,
        );
    return { run, operations, cursor: await tx.cursor() };
  }, READ_ONLY);
}

export function readEvents(
  store: DurableStore,
  id: string,
  after: number,
): Promise<DurableEvent[]> {
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
  return store.events(id, after, 100);
}

/** Owning scope for authorization without loading operation journals or graph results. */
export function readRunScope(store: DurableStore, runId: string): Promise<DurableRunScope> {
  return store.transaction(async (tx) => {
    const run = await requireRun(tx, runId);
    const base = { runId, agentId: run.agentId, sessionId: run.sessionId };
    if (run.graphId !== undefined)
      return {
        ...base,
        sessionId: (await requireGraph(tx, run.graphId)).submission.sessionId,
        graphId: run.graphId,
        taskId: run.taskId!,
      };
    if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return base;
    const task = await tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
    if (task === undefined || task.agentRunId !== runId)
      throw new DurableNotFoundError("Owned task is missing.");
    return {
      ...base,
      sessionId: task.sessionId,
      taskId: task.id,
      rootTaskId: task.rootId,
      taskName: task.name,
    };
  }, READ_ONLY);
}
