import { extractGraphFacts as extractSharedGraphFacts, GraphFactConflictError } from "@anvia/graph";
import type {
  ExtractGraphFactsOptions,
  ExtractGraphFactsResult,
  Neo4jGraphSchema,
} from "./types.js";

export { GraphFactConflictError };

export async function extractGraphFacts<
  Schema extends Neo4jGraphSchema,
  Model extends import("@anvia/core").CompletionModel,
>(options: ExtractGraphFactsOptions<Schema, Model>): Promise<ExtractGraphFactsResult<Schema>> {
  return extractSharedGraphFacts(options) as Promise<ExtractGraphFactsResult<Schema>>;
}
