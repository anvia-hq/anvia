import type { AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import {
  assertAgentInteractionResponse,
  parseAgentInteractionResponse,
  type AgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import { parseMessage, type ToolResultOutput } from "@anvia/core/completion";
import { externalizeSubmittedEvent, externalizeToolResult } from "./blob.js";
import { DurableConflictError, DurableNotFoundError } from "./errors.js";
import { requireGraph } from "./graph-state.js";
import { errorMessage, json, nonblank, sameJson } from "./json.js";
import { parsePrompt } from "./prompt.js";
import { isRecordedMemoryWrite, resolveRecordedMemoryWrite } from "./recorded-memory.js";
import { GRAPH_SESSION_PREFIX } from "./run-record.js";
import { queueSteering } from "./steering.js";
import { TASK_SESSION_PREFIX } from "./tasks/agent.js";
import { parseTraceOptions } from "./trace-schema.js";
import type {
  DurableRunRecord,
  DurableStore,
  DurableSteerOptions,
  DurableSubmission,
  DurableSubmitOptions,
  DurableTransaction,
  MemoryWriteResolution,
} from "./types.js";

/**
 * The state changes behind submit, steer, respond, resolve, retry and cancel. They are plain store
 * transactions with no executor in sight, so the owning `DurableRuntime` and a store-only
 * `DurableClient` run exactly the same rules (ADR 0001). The caller decides what happens after the
 * commit: the runtime pumps its scheduler, a client lets a worker's claim loop find the work.
 */

export const SETTLED_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];

export async function requireRun(tx: DurableTransaction, id: string): Promise<DurableRunRecord> {
  const run = await tx.getRun(id);
  if (run === undefined) throw new DurableNotFoundError(`Unknown durable run: ${id}`);
  return run;
}

export async function assertOwnedTaskMutable(
  tx: DurableTransaction,
  run: DurableRunRecord,
): Promise<void> {
  if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return;
  const task = await tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
  if (
    task === undefined ||
    ["completing", "cancelling", "completed", "failed", "cancelled"].includes(task.status)
  )
    throw new DurableConflictError(
      "Owned task outcomes are immutable; create a new task submission.",
    );
}

async function assertGraphOpen(tx: DurableTransaction, run: DurableRunRecord): Promise<void> {
  if (run.graphId !== undefined && (await requireGraph(tx, run.graphId)).cancelled)
    throw new DurableConflictError("Graph is cancelled.");
}

export async function setStatus(
  tx: DurableTransaction,
  run: DurableRunRecord,
  status: DurableRunRecord["status"],
): Promise<void> {
  run.status = status;
  run.updatedAt = new Date().toISOString();
  await tx.putRun(run);
  // Status events stay small: the outcome lives on the run record and clients read it from the
  // snapshot. Embedding it here duplicated every completed outcome in the journal (DUR-07).
  await tx.appendEvent(
    run.id,
    "status",
    json({
      status,
      error: run.error,
      blockedOperation: run.blockedOperation,
      nextAttemptAt: run.nextAttemptAt,
    }),
  );
}

/** Validates a submission's shape. Whether its agent exists is the caller's concern. */
export function parseSubmission(
  input: DurableSubmission,
  options: DurableSubmitOptions,
): DurableSubmission {
  if (options.enqueue !== undefined && typeof options.enqueue !== "boolean")
    throw new TypeError("enqueue must be a boolean.");
  for (const key of ["agentId", "sessionId", "requestId"] as const) nonblank(input[key], key);
  if (
    input.sessionId.startsWith(GRAPH_SESSION_PREFIX) ||
    input.sessionId.startsWith(TASK_SESSION_PREFIX)
  )
    throw new TypeError("Reserved durable session ID.");
  const trace = parseTraceOptions(input.trace);
  const submission: DurableSubmission = {
    agentId: input.agentId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    prompt: parsePrompt(input.prompt),
  };
  if (trace !== undefined) submission.trace = trace;
  return submission;
}

/**
 * Records one submission, or returns the run an earlier identical `(sessionId, requestId)` made.
 * `create` builds the record; `settling` lets the runtime refuse a session whose previous attempt
 * is still winding down in-process.
 */
export function submitRun(
  store: DurableStore,
  submission: DurableSubmission,
  options: DurableSubmitOptions,
  create: (tx: DurableTransaction) => Promise<DurableRunRecord>,
  settling: () => boolean = () => false,
): Promise<string> {
  return store.transaction(async (tx) => {
    // Without it two submitters could both see a session with no unfinished work.
    await tx.lockSession?.(submission.sessionId);
    const existing = await tx.findRequest(submission.sessionId, submission.requestId);
    if (existing !== undefined) {
      if (existing.agentId !== submission.agentId || !sameJson(existing.prompt, submission.prompt))
        throw new DurableConflictError("requestId already belongs to a different submission.");
      return existing.id;
    }
    if (!options.enqueue && (await tx.activeRun(submission.sessionId)) !== undefined)
      throw new DurableConflictError("Session already has unfinished work.");
    if (!options.enqueue && settling())
      throw new DurableConflictError("Previous session execution is still settling.");
    const run = await create(tx);
    await tx.putRun(run);
    await tx.appendEvent(
      run.id,
      "submitted",
      json(await tx.blobs((io) => externalizeSubmittedEvent(io, submission))),
    );
    return run.id;
  });
}

export function steerRun(
  store: DurableStore,
  id: string,
  input: AgentSteerInput,
  options: DurableSteerOptions,
): Promise<AgentSteerReceipt> {
  return store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    await assertOwnedTaskMutable(tx, run);
    await assertGraphOpen(tx, run);
    return queueSteering(tx, run, input, options);
  });
}

export async function respondToRun(
  store: DurableStore,
  id: string,
  interactionId: string,
  value: AgentInteractionResponse,
): Promise<void> {
  nonblank(interactionId, "Interaction ID");
  const response = parseAgentInteractionResponse(value);
  await store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    await assertGraphOpen(tx, run);
    if (Object.hasOwn(run.responses, interactionId)) {
      if (!sameJson(run.responses[interactionId], response))
        throw new DurableConflictError("Interaction already received a different response.");
      return;
    }
    await assertOwnedTaskMutable(tx, run);
    if (
      run.status !== "waiting" ||
      run.outcome?.type !== "interaction" ||
      run.outcome.interaction.id !== interactionId
    ) {
      throw new DurableConflictError("No matching pending interaction.");
    }
    try {
      assertAgentInteractionResponse(run.outcome.interaction, response);
    } catch (error) {
      throw new DurableConflictError(errorMessage(error));
    }
    run.responses[interactionId] = json(response);
    const continuation = run.outcome.continuation;
    // Core resumes with previous segments as history and returns messages from the new segment.
    run.history = [...run.history, ...run.outcome.messages];
    run.input = { continuation, response };
    run.epoch += 1;
    delete run.outcome;
    await setStatus(tx, run, "pending");
  });
}

export async function resolveToolForRun(
  store: DurableStore,
  id: string,
  operationId: string,
  output: ToolResultOutput,
): Promise<void> {
  await store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    await assertOwnedTaskMutable(tx, run);
    await assertGraphOpen(tx, run);
    if (run.status !== "needs_attention" || run.blockedOperation !== operationId) {
      throw new DurableConflictError("No matching tool awaiting reconciliation.");
    }
    const operation = await tx.getOperation(id, operationId);
    if (operation?.kind !== "tool" || operation.status !== "started")
      throw new DurableConflictError("Operation cannot be reconciled.");
    const checked = parseMessage({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: operationId, toolName: "reconciled", output }],
    });
    if (checked.role !== "tool" || checked.content[0]?.type !== "tool-result")
      throw new TypeError("Invalid tool result.");
    // A reconciled output gets the same bounded-reference treatment as a live tool result.
    const reconciledOutput = checked.content[0].output;
    const result = await tx.blobs((io) =>
      externalizeToolResult(io, json({ output: reconciledOutput, failed: false })),
    );
    await tx.putOperation(id, { ...operation, status: "completed", result });
    await tx.appendEvent(id, "tool_completed", { operationId, result, reconciled: true });
    delete run.blockedOperation;
    delete run.error;
    await setStatus(tx, run, "pending");
  });
}

export async function resolveMemoryWriteForRun(
  store: DurableStore,
  id: string,
  operationKey: string,
  resolution: MemoryWriteResolution,
): Promise<void> {
  if (resolution !== "applied" && resolution !== "discarded")
    throw new TypeError('resolution must be "applied" or "discarded".');
  await store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    await assertOwnedTaskMutable(tx, run);
    if (run.status !== "needs_attention" || run.blockedOperation !== operationKey)
      throw new DurableConflictError("No matching memory write awaiting resolution.");
    const operation = await tx.getOperation(id, operationKey);
    if (
      operation === undefined ||
      !isRecordedMemoryWrite(operation) ||
      operation.status !== "started"
    )
      throw new DurableConflictError("Operation cannot be resolved.");
    await resolveRecordedMemoryWrite(tx, run, operation, resolution);
    delete run.blockedOperation;
    delete run.error;
    await setStatus(tx, run, "pending");
  });
}

/**
 * Restarts a failed or blocked run. A run with no committed history (its admission rolled back)
 * needs its history rebuilt from the session before it executes. `rebuildHistory` does that in
 * the caller's own terms: the runtime does it now, a client (which knows nothing of the agent's
 * memory) passes `"defer"` and hands the run back as `queued`, so the worker that claims it does.
 */
export async function retryRun(
  store: DurableStore,
  id: string,
  rebuildHistory: ((tx: DurableTransaction, run: DurableRunRecord) => Promise<void>) | "defer",
): Promise<void> {
  await store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    await assertOwnedTaskMutable(tx, run);
    await assertGraphOpen(tx, run);
    if (run.status !== "failed" && run.status !== "needs_attention")
      throw new DurableConflictError("Only failed or blocked runs can be retried.");
    const other = await tx.activeRun(run.sessionId);
    if (other !== undefined && other.id !== id && other.status !== "queued")
      throw new DurableConflictError("Session already has unfinished work.");
    if (await tx.hasLaterStartedRun(id))
      throw new DurableConflictError("Session has advanced; create a new submission.");
    const operations = await tx.operations(id);
    let next: "queued" | "pending" = "pending";
    if (run.graphId === undefined && run.history.length === 0 && operations.length === 0) {
      if (rebuildHistory === "defer") next = "queued";
      else await rebuildHistory(tx, run);
    }
    for (const operation of operations) {
      if (
        (operation.kind === "model" ||
          operation.kind === "compaction" ||
          operation.kind === "context" ||
          isRecordedMemoryWrite(operation)) &&
        operation.status === "started"
      )
        // An uncertain memory write is sent again only here, on an explicit retry; its key
        // makes a repeat of a committed write a duplicate.
        await tx.putOperation(id, { ...operation, attempts: 0 });
    }
    delete run.error;
    delete run.blockedOperation;
    delete run.exhaustion;
    run.retries = (run.retries ?? 0) + 1;
    await setStatus(tx, run, next);
  });
}

/** Settles an unfinished run as cancelled and returns its session. */
export function cancelRun(store: DurableStore, id: string): Promise<string> {
  return store.transaction(async (tx) => {
    const run = await requireRun(tx, id);
    if (SETTLED_STATUSES.includes(run.status)) return run.sessionId;
    delete run.nextAttemptAt;
    run.error = "Durable run cancelled.";
    await setStatus(tx, run, "cancelled");
    return run.sessionId;
  });
}
