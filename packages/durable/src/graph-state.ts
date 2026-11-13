import { assertMemoryFreeTask } from "./recorded-memory.js";
import type { AgentPrompt } from "@anvia/core/agent";
import type { JsonValue } from "@anvia/core/completion";
import { DurableConflictError, DurableNotFoundError } from "./errors.js";
import { externalizeSubmittedEvent, hydratedOutcomeOutput } from "./blob.js";
import { json, sameJson } from "./json.js";
import { GRAPH_SESSION_PREFIX, createRunRecord } from "./run-record.js";
import type { DurableAgentRegistration, DurableRunRecord, DurableTransaction } from "./types.js";
import type { DurableMcpServers } from "./mcp-servers.js";
import type { DurableToolIndexes } from "./tool-indexes.js";
import type {
  DurableGraphRecord,
  DurableGraphSnapshot,
  DurableGraphSubmission,
  DurableTaskWait,
} from "./graph-types.js";

export async function createGraph(
  tx: DurableTransaction,
  submission: DurableGraphSubmission,
  agents: ReadonlyMap<string, DurableAgentRegistration>,
  mcpServers: ReadonlyMap<string, DurableMcpServers>,
  toolIndexes: ReadonlyMap<string, DurableToolIndexes>,
): Promise<string> {
  const existing = await tx.findGraphRequest(submission.sessionId, submission.requestId);
  if (existing !== undefined) {
    if (!sameJson(existing.submission, submission))
      throw new DurableConflictError("Graph requestId already belongs to a different submission.");
    return existing.id;
  }
  const id = globalThis.crypto.randomUUID();
  const runs: { task: (typeof submission.tasks)[number]; run: DurableRunRecord }[] = [];
  for (const task of submission.tasks) {
    const registration = agents.get(task.agentId);
    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${task.agentId}`);
    assertMemoryFreeTask(registration, task.agentId, "graph tasks");
    runs.push({
      task,
      run: await createRunRecord(
        {
          agentId: task.agentId,
          sessionId: `${GRAPH_SESSION_PREFIX}${id}:${task.id}`,
          requestId: task.id,
          prompt: task.prompt,
        },
        registration,
        tx,
        mcpServers.get(task.agentId),
        toolIndexes.get(task.agentId),
      ),
    });
  }
  const runIds = Object.fromEntries(runs.map(({ task, run }) => [task.id, run.id]));
  const graph: DurableGraphRecord = {
    id,
    submission,
    createdAt: new Date().toISOString(),
    cancelled: false,
    runIds,
  };
  await tx.putGraph(graph);
  for (const { task, run } of runs) {
    run.graphId = id;
    run.taskId = task.id;
    run.dependencies = (task.dependsOn ?? []).map((dependency) => runIds[dependency]!);
    await tx.putRun(run);
    await tx.appendEvent(
      run.id,
      "submitted",
      await tx.blobs((io) =>
        externalizeSubmittedEvent(io, { graphId: id, taskId: task.id, prompt: task.prompt }),
      ),
    );
  }
  return id;
}

export async function requireGraph(
  tx: DurableTransaction,
  id: string,
): Promise<DurableGraphRecord> {
  const graph = await tx.getGraph(id);
  if (graph === undefined) throw new DurableNotFoundError(`Unknown durable graph: ${id}`);
  return graph;
}

export async function graphSnapshot(
  tx: DurableTransaction,
  id: string,
): Promise<DurableGraphSnapshot> {
  const graph = await requireGraph(tx, id);
  const runs = new Map<string, DurableRunRecord>();
  for (const task of graph.submission.tasks)
    runs.set(task.id, (await tx.getRun(graph.runIds[task.id]!))!);
  const nodes: DurableGraphSnapshot["nodes"] = [];
  for (const task of graph.submission.tasks) {
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
    else if (run.status === "needs_attention") {
      wait = { type: "recovery" };

      if (run.blockedOperation !== undefined) {
        wait.operationId = run.blockedOperation;
      }
    }

    const node: DurableGraphSnapshot["nodes"][number] = {
      id: task.id,
      agentId: task.agentId,
      runId: run.id,
      status: run.status,
    };

    if (wait !== undefined) {
      node.wait = wait;
    }

    if (run.error !== undefined) {
      node.error = run.error;
    }

    if (run.outcome?.type === "response") {
      node.output = json(
        (await tx.blobs((io) => hydratedOutcomeOutput(io, json(run.outcome)))) ?? null,
      );
    }

    if (run.outcome?.type === "interaction") {
      node.interaction = run.outcome.interaction;
    }

    nodes.push(node);
  }
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
    cursor: await tx.cursor(),
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
export async function graphInput(
  tx: DurableTransaction,
  run: DurableRunRecord,
): Promise<AgentPrompt> {
  const values: Record<string, JsonValue> = {};
  for (const dependency of run.dependencies ?? []) {
    const prerequisite = await tx.getRun(dependency);
    if (
      prerequisite === undefined ||
      prerequisite.graphId !== run.graphId ||
      !successful(prerequisite) ||
      prerequisite.outcome?.type !== "response"
    )
      throw new DurableConflictError("Task dependencies are not successful.");
    values[prerequisite.taskId!] = json(
      (await tx.blobs((io) => hydratedOutcomeOutput(io, json(prerequisite.outcome)))) ?? null,
    );
  }
  if (Object.keys(values).length === 0) return run.prompt;
  const suffix = `\n\nTask dependency results (JSON):\n${JSON.stringify(values)}`;
  if (typeof run.prompt === "string") return run.prompt + suffix;
  const content = run.prompt.content;
  return {
    ...run.prompt,
    content:
      typeof content === "string" ? content + suffix : [...content, { type: "text", text: suffix }],
  };
}
