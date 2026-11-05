import { createHash } from "node:crypto";
import { isVectorContext, type Agent } from "@anvia/core/agent";
import type { Document } from "@anvia/core/completion";
import { canonicalJson, json } from "./json.js";

/**
 * The static context documents of a registered agent, frozen at submission: a content hash for
 * replay verification plus a JSON copy of the resolved documents. A run never re-reads the
 * registration's documents; a registration whose current documents hash differently fails the run
 * with a recovery error instead of silently changing context.
 */
export type DurableContextDocuments = { hash: string; documents: Document[] };

export function contextDocumentsOf(agent: Agent<unknown>): DurableContextDocuments | undefined {
  // The registration gate has already rejected vector contexts, so every entry is a Document.
  const documents = agent.context
    .filter((input) => !isVectorContext(input))
    .map((input) => json(input) as Document);
  if (documents.length === 0) return undefined;
  return { hash: hashDocuments(documents), documents };
}

export function hashDocuments(documents: readonly Document[]): string {
  return createHash("sha256")
    .update(canonicalJson(json(documents)))
    .digest("hex");
}
