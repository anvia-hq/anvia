import { promptMessage } from "./prompt.js";
import { Usage } from "@anvia/core/completion";
import { externalizeContextDocuments } from "./blob.js";
import { contextDocumentsOf } from "./documents.js";
import type { DurableMcpServers } from "./mcp-servers.js";
import { vectorContextOf } from "./vector-context.js";
import type { DurableToolIndexes } from "./tool-indexes.js";
import type {
  DurableAgentRegistration,
  DurableRunRecord,
  DurableSubmission,
  DurableTransaction,
} from "./types.js";

export const GRAPH_SESSION_PREFIX = "__anvia_graph__:";
export const UNADMITTED_VERSION = "unadmitted";

/**
 * `tx` enables blob externalization for a large context snapshot; without it the snapshot is
 * stored inline, which the payload budget still bounds. `mcpServers` is the fingerprint computed by
 * the caller before the transaction (see mcpServersOf). `toolIndexes` is the fingerprint computed
 * by the caller before the transaction (see toolIndexesOf).
 */
export async function createRunRecord(
  submission: DurableSubmission,
  registration: DurableAgentRegistration,
  tx?: DurableTransaction,
  mcpServers?: DurableMcpServers,
  toolIndexes?: DurableToolIndexes,
): Promise<DurableRunRecord> {
  return admitRunRecord(
    createUnadmittedRunRecord(submission),
    registration,
    tx,
    mcpServers,
    toolIndexes,
  );
}

/**
 * A run submitted by a client that holds no agent registrations. It carries only the request; the
 * worker that claims it fills in everything a registration decides (`admitRunRecord`) before the
 * first attempt. `version` is a placeholder until then.
 */
export function createUnadmittedRunRecord(submission: DurableSubmission): DurableRunRecord {
  const now = new Date().toISOString();
  return {
    ...submission,
    id: globalThis.crypto.randomUUID(),
    version: UNADMITTED_VERSION,
    unadmitted: true,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    epoch: 0,
    modelTurns: 0,
    maxModelTurns: 1,
    usage: Usage.empty(),
    history: [],
    responses: {},
    steering: { pending: [], checkpoints: {}, closed: false },
    input: { messages: [promptMessage(submission.prompt)] },
  };
}

/** Applies what the agent's registration decides to a run: its version, limits and frozen context. */
export async function admitRunRecord(
  base: DurableRunRecord,
  registration: DurableAgentRegistration,
  tx?: DurableTransaction,
  mcpServers?: DurableMcpServers,
  toolIndexes?: DurableToolIndexes,
): Promise<DurableRunRecord> {
  const record: DurableRunRecord = { ...base };
  delete record.unadmitted;
  record.version = registration.version;
  record.maxModelTurns = (registration.agent.defaultMaxTurns ?? 0) + 1;

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
        : ((await tx.blobs((io) => externalizeContextDocuments(io, contextDocuments))) as {
            hash: string;
            documents?: typeof contextDocuments.documents;
          });
  }

  if (mcpServers !== undefined) record.mcpServers = { ...mcpServers };
  if (toolIndexes !== undefined) record.toolIndexes = { ...toolIndexes };

  // Live vector retrieval is recorded per model call; the settings freeze with the run.
  if (registration.context !== undefined) {
    const vectorContext = vectorContextOf(registration.agent);
    if (vectorContext !== undefined) record.vectorContext = vectorContext;
  }

  if (registration.modelRetry !== undefined) {
    record.modelRetry = { ...registration.modelRetry };
  }

  return record;
}
