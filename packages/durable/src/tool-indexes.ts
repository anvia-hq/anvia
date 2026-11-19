import { createHash } from "node:crypto";
import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type { Agent } from "@anvia/core/agent";
import type { ToolIndex } from "@anvia/core/tool";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import { canonicalJson, json } from "./json.js";
import type { DurableAgentRegistration } from "./types.js";

/**
 * The tool indexes of a registered agent, fingerprinted at submission. The index's embedded
 * documents are not readable, so the hash covers what a registered index exposes: each index's
 * search settings, its embedding model, its tools' definitions, and the retrieval text those tools
 * embed. The embedded vectors themselves are covered through that text, which is what a changed
 * embedding model or content callback actually changes; a store whose contents differ while its
 * text and settings match is the one case the hash cannot see.
 */
export type DurableToolIndexes = { hash: string };

export async function toolIndexesOf(
  agent: Agent<unknown>,
): Promise<DurableToolIndexes | undefined> {
  const indexes = getResolvedAgentOptions(agent).toolIndexes ?? [];
  if (indexes.length === 0) return undefined;
  const fingerprint = await Promise.all(indexes.map(fingerprintIndex));
  return {
    hash: createHash("sha256")
      .update(canonicalJson(json(fingerprint)))
      .digest("hex"),
  };
}

async function fingerprintIndex(index: ToolIndex): Promise<unknown> {
  // The definitions a turn can offer, which a replay reads back; see fetchToolDefinitions.
  const definitions = new Map<string, unknown>();
  for (const tool of index.tools) {
    definitions.set(tool.name, json(await tool.definition("")));
  }
  return {
    settings: {
      topK: index.topK,
      minScore: index.minScore ?? null,
      filter: index.filter ?? null,
    },
    model: modelIdentity(realIndex(index).embeddingModel),
    embedded: embeddedText(index),
    tools: [...definitions].map(([name, definition]) => ({ name, definition })),
  };
}

/**
 * Created indexes expose the model and the text they embedded; a structurally supplied index may
 * not. An index that cannot describe itself hashes as `unknown`, so two such indexes with the same
 * settings and tools stay interchangeable, as they were before these fields existed.
 */
function realIndex(index: ToolIndex): {
  embeddingModel?: EmbeddingModel | undefined;
  embeddedDocuments?: readonly { id: string; text: string }[] | undefined;
} {
  return index as unknown as {
    embeddingModel?: EmbeddingModel | undefined;
    embeddedDocuments?: readonly { id: string; text: string }[] | undefined;
  };
}

function modelIdentity(model: EmbeddingModel | undefined): unknown {
  if (model === undefined) return "unknown";
  return { provider: model.provider, modelId: model.modelId, dimensions: model.dimensions ?? null };
}

function embeddedText(index: ToolIndex): unknown {
  const documents = realIndex(index).embeddedDocuments;
  if (documents === undefined) return "unknown";
  return documents.map((document) => ({ id: document.id, text: document.text }));
}

/** Fingerprints for the registrations that admit tool indexes, keyed by agent id. */
export async function toolIndexesByAgent(
  agents: ReadonlyMap<string, DurableAgentRegistration>,
  agentIds: readonly string[],
): Promise<Map<string, DurableToolIndexes>> {
  const result = new Map<string, DurableToolIndexes>();
  for (const agentId of new Set(agentIds)) {
    const registration = agents.get(agentId);
    if (registration?.toolIndexes === undefined) continue;
    const fingerprint = await toolIndexesOf(registration.agent);
    if (fingerprint !== undefined) result.set(agentId, fingerprint);
  }
  return result;
}
