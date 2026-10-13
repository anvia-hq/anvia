import type { AgentTraceOptions } from "@anvia/core/observability";
import type { JsonObject } from "@anvia/core/completion";
import { TASK_SESSION_PREFIX } from "./tasks/agent.js";
import type { DurableRunRecord, DurableTransaction } from "./types.js";

/**
 * Every execution of a run (retries, recovery, resumed interactions) shares one trace, grouped under
 * the caller's observability session, or else the session the application submitted rather than an
 * internal task or graph session. Task-owned runs use the root task's trace options.
 */
export function runTrace(tx: DurableTransaction, run: DurableRunRecord): AgentTraceOptions {
  const task = run.sessionId.startsWith(TASK_SESSION_PREFIX)
    ? tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length))
    : undefined;
  const root =
    task === undefined ? undefined : task.rootId === task.id ? task : tx.getTask(task.rootId);
  const graph = run.graphId === undefined ? undefined : tx.getGraph(run.graphId);
  const options = root?.trace ?? run.trace;
  const executionSessionId = task?.sessionId ?? graph?.submission.sessionId ?? run.sessionId;
  const sessionId = options?.sessionId ?? executionSessionId;
  const metadata: JsonObject = {
    ...applicationMetadata(options?.metadata),
    durableRunId: run.id,
    durableEpoch: run.epoch,
  };
  // Keeps the execution session discoverable when the observability session groups several.
  if (sessionId !== executionSessionId) {
    metadata.durableSessionId = executionSessionId;
  }

  if (task !== undefined) {
    metadata.durableTaskId = task.id;
    metadata.durableRootTaskId = task.rootId;
  }

  if (run.graphId !== undefined) {
    metadata.durableGraphId = run.graphId;
  }

  return {
    ...options,
    sessionId,
    // Run IDs are UUIDs, so the hex digits form a valid 128-bit trace ID.
    traceId: run.id.replaceAll("-", ""),
    metadata,
  };
}

const RUNTIME_METADATA_KEYS = [
  "durableRunId",
  "durableEpoch",
  "durableSessionId",
  "durableTaskId",
  "durableRootTaskId",
  "durableGraphId",
];

/**
 * The runtime adds only the durable keys that apply to a run, so application values for the others
 * are dropped rather than passed off as runtime identifiers.
 */
function applicationMetadata(metadata: JsonObject | undefined): JsonObject {
  if (metadata === undefined) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !RUNTIME_METADATA_KEYS.includes(key)),
  );
}
