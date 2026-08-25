import { createTool } from "@anvia/core/tool";
import { z } from "zod";
import type { CreateGraphSearchToolOptions, GraphSchemaLike, GraphSearchTool } from "./types.js";

const primitive = z.union([z.string(), z.number().finite(), z.boolean()]);
const propertyValue = z.union([
  primitive,
  z.array(z.string()),
  z.array(z.number().finite()),
  z.array(z.boolean()),
]);
const properties = z.record(z.string(), propertyValue);
const contextSchema = z.object({
  seeds: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      score: z.number().finite(),
      properties,
      sourceChunkIds: z.array(z.string()),
    }),
  ),
  nodes: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      identity: z.record(z.string(), primitive),
      properties,
      sourceChunkIds: z.array(z.string()),
    }),
  ),
  relationships: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      from: z.string(),
      to: z.string(),
      properties,
      sourceChunkIds: z.array(z.string()),
    }),
  ),
  evidence: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      index: z.number().int(),
      text: z.string(),
      metadata: properties,
    }),
  ),
});

export function createGraphSearchTool<Schema extends GraphSchemaLike>(
  options: CreateGraphSearchToolOptions<Schema>,
): GraphSearchTool {
  return createTool({
    name: options.name,
    description: options.description,
    inputSchema: z.object({
      query: z.string().min(1).describe("The question or concept to search for in the graph."),
    }),
    outputSchema: contextSchema,
    execute: async ({ query }, context) =>
      (await options.graph.retrieve({
        model: options.model,
        query,
        search: options.search,
        traversal: options.traversal,
        evidence: options.evidence,
        retries: options.retries,
        abortSignal: context.abortSignal,
      })) as unknown as z.input<typeof contextSchema>,
  }) as unknown as GraphSearchTool;
}
