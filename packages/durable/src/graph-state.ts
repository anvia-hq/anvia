import type { JsonValue } from "@anvia/core/completion";
import { DurableConflictError, DurableNotFoundError } from "./errors.js";
import { json, sameJson } from "./json.js";
import { GRAPH_SESSION_PREFIX, createRunRecord } from "./run-record.js";
import type { DurableAgentRegistration, DurableRunRecord, DurableTransaction } from "./types.js";
import type {
  DurableGraphRecord,
  DurableGraphSnapshot,
  DurableGraphSubmission,
  DurableTaskWait,
} from "./graph-types.js";

export function createGraph(
  tx: DurableTransaction,
  submission: DurableGraphSubmission,
  agents: ReadonlyMap<string, DurableAgentRegistration>,
): string {
  const existing = tx.findGraphRequest(submission.sessionId, submission.requestId);
  if (existing !== undefined) {
    if (!sameJson(existing.submission, submission))
      throw new DurableConflictError("Graph requestId already belongs to a different submission.");
    return existing.id;
  }
  const id = globalThis.crypto.randomUUID();
  const runs = submission.tasks.map((task) => {
    const registration = agents.get(task.agentId);
    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${task.agentId}`);
    return {
      task,
      run: createRunRecord(
        {
          agentId: task.agentId,
          sessionId: `${GRAPH_SESSION_PREFIX}${id}:${task.id}`,
          requestId: task.id,
          prompt: task.prompt,
        },
        registration,
      ),
    };
  });
  const runIds = Object.fromEntries(runs.map(({ task, run }) => [task.id, run.id]));
  const graph: DurableGraphRecord = {
    id,
    submission,
    createdAt: new Date().toISOString(),
    cancelled: false,
    runIds,
  };
  tx.putGraph(graph);
  for (const { task, run } of runs) {
    run.graphId = id;
    run.taskId = task.id;
    run.dependencies = (task.dependsOn ?? []).map((dependency) => runIds[dependency]!);
    tx.putRun(run);
    tx.appendEvent(
      run.id,
      "submitted",
      json({ graphId: id, taskId: task.id, prompt: task.prompt }),
    );
  }
  return id;
}

export function requireGraph(tx: DurableTransaction, id: string): DurableGraphRecord {
  const graph = tx.getGraph(id);
  if (graph === undefined) throw new DurableNotFoundError(`Unknown durable graph: ${id}`);
  return graph;
}

export function graphSnapshot(tx: DurableTransaction, id: string): DurableGraphSnapshot {
  const graph = requireGraph(tx, id);
  const runs = new Map(
    graph.submission.tasks.map((task) => [task.id, tx.getRun(graph.runIds[task.id]!)!]),
  );
  const nodes = graph.submission.tasks.map((task) => {
    const run = runs.get(task.id)!;
    if (run === undefined || run.graphId !== id || run.taskId !== task.id)
      throw new Error("Graph task/run mapping changed.");
    let wait: DurableTaskWait | undefined;
    if (run.status === "queued") {
      const incomplete = (task.dependsOn ?? []).filter(
        (dependency) => !successful(runs.get(dependency)!),
      );
      const failed = incomplete.filter((dependency) => dependencyFailed(runs.get(dependency)!));
      wait =
        failed.length > 0
          ? { type: "dependency_failed", taskIds: failed }
          : incomplete.length > 0
            ? { type: "dependencies", taskIds: incomplete }
            : { type: "capacity" };
    } else if (run.status === "retry_wait") wait = { type: "retry", until: run.nextAttemptAt! };
    else if (run.status === "waiting" && run.outcome?.type === "interaction")
      wait = { type: "interaction", interactionId: run.outcome.interaction.id };
    else if (run.status === "needs_attention")
      wait = {
        type: "recovery",
        ...(run.blockedOperation === undefined ? {} : { operationId: run.blockedOperation }),
      };
    return {
      id: task.id,
      agentId: task.agentId,
      runId: run.id,
      status: run.status,
      ...(wait === undefined ? {} : { wait }),
      ...(run.error === undefined ? {} : { error: run.error }),
      ...(run.outcome?.type === "response" ? { output: json(run.outcome.output) } : {}),
      ...(run.outcome?.type === "interaction" ? { interaction: run.outcome.interaction } : {}),
    };
  });
  const all = [...runs.values()];
  const status = graph.cancelled
    ? "cancelled"
    : all.every(successful)
      ? "completed"
      : nodes.some(
            (node) =>
              node.status === "running" ||
              node.status === "pending" ||
              node.wait?.type === "capacity",
          )
        ? "running"
        : all.some((run) => dependencyFailed(run) || run.status === "needs_attention")
          ? "blocked"
          : "waiting";
  return {
    id,
    sessionId: graph.submission.sessionId,
    requestId: graph.submission.requestId,
    createdAt: graph.createdAt,
    status,
    nodes,
    edges: graph.submission.tasks.flatMap((task) =>
      (task.dependsOn ?? []).map((source) => ({ source, target: task.id })),
    ),
    cursor: tx.cursor(),
  };
}

export function successful(run: DurableRunRecord): boolean {
  return run.status === "completed" && run.outcome?.type === "response";
}
function dependencyFailed(run: DurableRunRecord): boolean {
  return (
    run.status === "failed" ||
    run.status === "cancelled" ||
    (run.status === "completed" && !successful(run))
  );
}

/** Resolve dependency outputs once, in the same transaction that activates the task. */
export function graphInput(tx: DurableTransaction, run: DurableRunRecord): string {
  const values: Record<string, JsonValue> = {};
  for (const dependency of run.dependencies ?? []) {
    const prerequisite = tx.getRun(dependency);
    if (
      prerequisite === undefined ||
      prerequisite.graphId !== run.graphId ||
      !successful(prerequisite) ||
      prerequisite.outcome?.type !== "response"
    )
      throw new DurableConflictError("Task dependencies are not successful.");
    values[prerequisite.taskId!] = json(prerequisite.outcome.output);
  }
  return Object.keys(values).length === 0
    ? run.prompt
    : `${run.prompt}\n\nTask dependency results (JSON):\n${JSON.stringify(values)}`;
}
