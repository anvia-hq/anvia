import type { DurableRunRecord, DurableRunSummary } from "./types.js";

/** The bounded projection of a run that listings and status reads return. */
export function runSummary(run: DurableRunRecord): DurableRunSummary {
  const { id, agentId, sessionId, requestId, status, createdAt, updatedAt } = run;
  const summary: DurableRunSummary = {
    id,
    agentId,
    sessionId,
    requestId,
    status,
    createdAt,
    updatedAt,
  };
  if (run.error !== undefined) summary.error = run.error;
  if (run.blockedOperation !== undefined) summary.blockedOperation = run.blockedOperation;
  if (run.nextAttemptAt !== undefined) summary.nextAttemptAt = run.nextAttemptAt;
  return summary;
}
