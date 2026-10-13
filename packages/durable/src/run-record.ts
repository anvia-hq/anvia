import { promptMessage } from "./prompt.js";
import { Usage } from "@anvia/core/completion";
import type { DurableAgentRegistration, DurableRunRecord, DurableSubmission } from "./types.js";

export const GRAPH_SESSION_PREFIX = "__anvia_graph__:";
export function createRunRecord(
  submission: DurableSubmission,
  registration: DurableAgentRegistration,
): DurableRunRecord {
  const now = new Date().toISOString();
  const record: Omit<DurableRunRecord, "input"> = {
    ...submission,
    id: globalThis.crypto.randomUUID(),
    version: registration.version,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    epoch: 0,
    modelTurns: 0,
    maxModelTurns: (registration.agent.defaultMaxTurns ?? 0) + 1,
    usage: Usage.empty(),
    history: [],
    responses: {},
    steering: { pending: [], checkpoints: {}, closed: false },
  };
  if (registration.compaction !== undefined) {
    record.loopCompaction = true;
    record.compaction = { trigger: { ...registration.compaction.trigger } };
    if (registration.compaction.retention !== undefined) {
      record.compaction.retention = { ...registration.compaction.retention };
    }
  }
  if (registration.stream !== undefined) record.stream = registration.stream;
  if (registration.modelRetry !== undefined) record.modelRetry = { ...registration.modelRetry };
  return {
    ...record,
    input: { messages: [promptMessage(submission.prompt)] },
  };
}
