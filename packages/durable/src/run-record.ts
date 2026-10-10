import { promptMessage } from "./prompt.js";
import { Usage } from "@anvia/core/completion";
import type { DurableAgentRegistration, DurableRunRecord, DurableSubmission } from "./types.js";

export const GRAPH_SESSION_PREFIX = "__anvia_graph__:";
export function createRunRecord(
  submission: DurableSubmission,
  registration: DurableAgentRegistration,
): DurableRunRecord {
  const now = new Date().toISOString();
  return {
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
    ...(registration.compaction === undefined
      ? {}
      : {
          loopCompaction: true,
          compaction: {
            trigger: { ...registration.compaction.trigger },
            ...(registration.compaction.retention === undefined
              ? {}
              : { retention: { ...registration.compaction.retention } }),
          },
        }),
    responses: {},
    steering: { pending: [], checkpoints: {}, closed: false },
    ...(registration.stream === undefined ? {} : { stream: registration.stream }),
    ...(registration.modelRetry === undefined
      ? {}
      : { modelRetry: { ...registration.modelRetry } }),
    input: { messages: [promptMessage(submission.prompt)] },
  };
}
