import { createHash } from "node:crypto";
import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type { Agent } from "@anvia/core/agent";
import { canonicalJson, json } from "./json.js";
import type { DurableAgentRegistration } from "./types.js";

/**
 * The tool indexes of a registered agent, fingerprinted at submission. The index's embedded
 * documents are not readable, so the hash covers what can be read: each index's search settings and
 * each of its tools' definitions. Replay reuses the recorded tool selection; the hash only proves the
 * registration still offers the same tools. The embedding model is not part of the hash, so a model
 * change still needs a registration version bump.
 */
export type DurableToolIndexes = { hash: string };

export async function toolIndexesOf(
  agent: Agent<unknown>,
): Promise<DurableToolIndexes | undefined> {
  const indexes = getResolvedAgentOptions(agent).toolIndexes ?? [];
  if (indexes.length === 0) return undefined;
  const fingerprint = await Promise.all(
    indexes.map(async (index) => ({
      topK: index.topK,
      minScore: index.minScore ?? null,
      filter: index.filter ?? null,
      tools: await Promise.all(
        index.tools.map(async (tool) => ({
          name: tool.name,
          definition: json(await tool.definition("")),
        })),
      ),
    })),
  );
  return {
    hash: createHash("sha256")
      .update(canonicalJson(json(fingerprint)))
      .digest("hex"),
  };
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
