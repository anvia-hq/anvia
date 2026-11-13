import { DurableConflictError, DurableNotFoundError } from "../errors.js";
import { hydratedOutcomeOutput } from "../blob.js";
import { json, nonblank, sameJson } from "../json.js";
import type { DurableTraceOptions, DurableTransaction } from "../types.js";
import type { RegisteredTask, TaskRecord } from "./types.js";

export function taskKey(value: string): void {
  nonblank(value, "Task key");
  if (value.length > 256 || value !== value.trim())
    throw new TypeError("Task keys must be trimmed and at most 256 characters.");
  if (value === "__proto__") throw new TypeError("Reserved task key.");
}
export async function requireTask(tx: DurableTransaction, id: string): Promise<TaskRecord> {
  const task = await tx.getTask(id);
  if (task === undefined) throw new DurableNotFoundError(`Unknown durable task: ${id}`);
  return task;
}
export function terminal(task: TaskRecord): boolean {
  return ["completed", "failed", "cancelled"].includes(task.status);
}
export async function saveTask(tx: DurableTransaction, task: TaskRecord): Promise<void> {
  task.updatedAt = new Date().toISOString();
  await tx.putTask(task);
  await tx.appendEvent(
    task.id,
    "status",
    json({
      status: task.status,
      wait: task.wait,
      outcome: task.outcome,
      error: task.error,
      blockedOperation: task.blockedOperation,
    }),
  );
}
export async function createTask(
  tx: DurableTransaction,
  definition: RegisteredTask,
  input: unknown,
  sessionId: string,
  key: string,
  parentId?: string,
  trace?: DurableTraceOptions,
): Promise<TaskRecord> {
  const { task, created } = await prepareTask(
    tx,
    definition,
    input,
    sessionId,
    key,
    parentId,
    trace,
  );
  if (created) {
    await tx.putTask(task);
    await tx.appendEvent(
      task.id,
      "submitted",
      json({ name: task.name, parentId, rootId: task.rootId }),
    );
  }
  return task;
}

/** Resolve an idempotent submission without persisting or scheduling work. */
export async function prepareTask(
  tx: DurableTransaction,
  definition: RegisteredTask,
  input: unknown,
  sessionId: string,
  key: string,
  parentId?: string,
  trace?: DurableTraceOptions,
): Promise<{ task: TaskRecord; created: boolean }> {
  taskKey(key);
  taskKey(sessionId);
  let parsed;
  try {
    parsed = definition.parseInput(input);
  } catch (cause) {
    if (cause instanceof TypeError) throw cause;
    throw new TypeError("Invalid task input.", { cause });
  }
  const parent = parentId === undefined ? undefined : await requireTask(tx, parentId);
  if (parent !== undefined && parent.status !== "running")
    throw new DurableConflictError("Parent task is no longer running.");
  const existing = await tx.findTask(sessionId, parentId, key);
  if (existing !== undefined) {
    if (
      existing.name !== definition.name ||
      existing.submissionVersion !== definition.version ||
      !sameJson(existing.submissionInput, parsed)
    )
      throw new DurableConflictError("Task key already belongs to a different submission.");
    return { task: existing, created: false };
  }
  if (
    parent !== undefined &&
    (parent.depth >= 32 || (await tx.taskTree(parent.rootId)).length >= 1000)
  )
    throw new DurableConflictError("Task trees support at most 1000 nodes and depth 32.");
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id,
    rootId: parent?.rootId ?? id,
    depth: parent === undefined ? 0 : parent.depth + 1,
    sessionId,
    key,
    name: definition.name,
    version: definition.version,
    submissionVersion: definition.version,
    submissionInput: parsed,
    input: parsed,
    checkpoint: definition.initial(parsed),
    status: "pending",
    signals: {},
    createdAt: now,
    updatedAt: now,
  };

  if (parentId !== undefined) {
    task.parentId = parentId;
  }

  if (parent === undefined && trace !== undefined) {
    task.trace = trace;
  }

  return { task, created: true };
}

/** Fence the whole owned subtree in one transaction before aborting invocations. */
export async function cancelTree(
  tx: DurableTransaction,
  id: string,
  error: string,
): Promise<string[]> {
  const ids: string[] = [];
  const pending = [await requireTask(tx, id)];
  for (const task of pending) {
    if (terminal(task)) continue;
    ids.push(task.id);
    pending.push(...(await tx.taskChildren(task.id)));
    task.status = "cancelling";
    task.outcome = { status: "cancelled", error };
    if (task.agentRunId !== undefined) {
      const run = (await tx.getRun(task.agentRunId))!;
      if (!["completed", "failed", "cancelled"].includes(run.status)) {
        run.status = "cancelled";
        run.error = error;
        run.updatedAt = new Date().toISOString();
        delete run.nextAttemptAt;
        await tx.putRun(run);
        await tx.appendEvent(run.id, "status", { status: "cancelled", error });
      }
    }
    delete task.wait;
    delete task.error;
    delete task.blockedOperation;
    await saveTask(tx, task);
  }
  return ids;
}

export async function reconcileTree(
  tx: DurableTransaction,
  rootId: string,
  active: ReadonlySet<string>,
  agentActive: (id: string) => boolean,
): Promise<{ abort: string[]; deadline?: number }> {
  const abort: string[] = [];
  let deadline: number | undefined;
  const nodes = (await tx.taskTree(rootId)).reverse();
  for (const node of nodes) {
    const task = await requireTask(tx, node.id);
    if (terminal(task)) continue;
    if (task.status === "waiting") {
      const wait = task.wait!;
      let ready = false;
      if (wait.type === "children") {
        const children: TaskRecord[] = [];
        for (const id of wait.ids) children.push(await requireTask(tx, id));
        if (
          wait.policy === "failFast" &&
          children.some((child) => terminal(child) && child.status !== "completed")
        ) {
          for (const child of children)
            if (!terminal(child) && child.status !== "cancelling")
              abort.push(...(await cancelTree(tx, child.id, "Sibling task failed.")));
        }
        ready = children.every(terminal);
      } else if (wait.type === "agent") {
        const run = await tx.getRun(wait.runId);
        if (run === undefined) throw new Error("Owned agent run is missing.");
        if (wait.status !== run.status) {
          wait.status = run.status;
          await saveTask(tx, task);
        }
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          task.outcome =
            run.status === "completed" && run.outcome?.type === "response"
              ? {
                  status: "completed",
                  output: json(
                    (await tx.blobs((io) => hydratedOutcomeOutput(io, json(run.outcome)))) ?? null,
                  ),
                }
              : {
                  status: run.status === "cancelled" ? "cancelled" : "failed",
                  error: run.error ?? "Agent did not return a successful response.",
                };
          task.status = "completing";
          delete task.wait;
          await saveTask(tx, task);
        }
      } else if (wait.type === "signal") ready = Object.hasOwn(task.signals, wait.name);
      else {
        const until = Date.parse(wait.until);
        ready = until <= Date.now();
        if (!ready) deadline = Math.min(deadline ?? Infinity, until);
      }
      if (ready) {
        task.status = "pending";
        delete task.wait;
        await saveTask(tx, task);
      }
    }
    if (
      ["completing", "cancelling"].includes(task.status) &&
      !active.has(task.id) &&
      (task.agentRunId === undefined || !agentActive(task.agentRunId)) &&
      (await tx.taskChildren(task.id)).every(terminal)
    ) {
      task.status = task.outcome!.status;
      await saveTask(tx, task);
    }
  }

  const result: { abort: string[]; deadline?: number } = { abort };

  if (deadline !== undefined) {
    result.deadline = deadline;
  }

  return result;
}
