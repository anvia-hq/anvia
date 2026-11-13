import { createHash } from "node:crypto";
import { isVectorContext, type Agent } from "@anvia/core/agent";
import { canonicalJson, json } from "./json.js";

/**
 * The vector contexts of a registered agent, fingerprinted at submission. The hash covers what can
 * be read from the settings: each context's position, topK, minScore, filter, retries, whether it
 * formats results (and the formatter's source), the embedding models' provider, id and dimensions,
 * and the store's class name. It cannot cover the embedding model's weights, the store's contents or
 * its connection, so a change there needs a registration version bump. Replay reuses the recorded
 * documents; the hash only proves the registration still asks the same question.
 */
export type DurableVectorContext = { hash: string };

type Identity = { provider: string; modelId: string; dimensions?: number | undefined };

function identity(model: Identity): Record<string, unknown> {
  return { provider: model.provider, modelId: model.modelId, dimensions: model.dimensions ?? null };
}

export function vectorContextOf(agent: Agent<unknown>): DurableVectorContext | undefined {
  const fingerprint = agent.context.flatMap((input, index) => {
    if (!isVectorContext(input)) return [];
    const models =
      "models" in input && input.models !== undefined
        ? { dense: identity(input.models.dense), sparse: identity(input.models.sparse) }
        : { dense: identity(input.model!) };
    return [
      {
        index,
        topK: input.topK,
        minScore: input.minScore ?? null,
        filter: input.filter ?? null,
        retries: input.retries ?? null,
        fusion: "fusion" in input ? (input.fusion ?? null) : null,
        format: input.format === undefined ? null : input.format.toString(),
        store: (input.store as object).constructor?.name ?? null,
        models,
      },
    ];
  });
  if (fingerprint.length === 0) return undefined;
  return {
    hash: createHash("sha256")
      .update(canonicalJson(json(fingerprint)))
      .digest("hex"),
  };
}
