import { promptMessage } from "./prompt.js";
import { Usage } from "@anvia/core/completion";
import { externalizeContextDocuments } from "./blob.js";
import { contextDocumentsOf } from "./documents.js";
import type {
  DurableAgentRegistration,
  DurableRunRecord,
  DurableSubmission,
  DurableTransaction,
} from "./types.js";

export const GRAPH_SESSION_PREFIX = "__anvia_graph__:";

/**
 * `tx` enables blob externalization for a large context snapshot; without it the snapshot is
 * stored inline, which the payload budget still bounds.
 */
export function createRunRecord(
  submission: DurableSubmission,
  registration: DurableAgentRegistration,
  tx?: DurableTransaction,
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

  if (registration.stream !== undefined) {
    record.stream = registration.stream;
  }

  // Static context documents freeze with the run, so a restart or retry replays identical context.
  const contextDocuments = contextDocumentsOf(registration.agent);
  if (contextDocuments !== undefined) {
    record.contextDocuments =
      tx === undefined
        ? contextDocuments
        : (externalizeContextDocuments(tx, contextDocuments) as {
            hash: string;
            documents?: typeof contextDocuments.documents;
          });
  }

  if (registration.modelRetry !== undefined) {
    record.modelRetry = { ...registration.modelRetry };
  }

  return {
    ...record,
    input: { messages: [promptMessage(submission.prompt)] },
  };
}
