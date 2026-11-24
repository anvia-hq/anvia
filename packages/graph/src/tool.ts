import { createTool } from "@anvia/core/tool";
import { z } from "zod";
import { DEFAULT_GRAPH_SEARCH_TOP_K } from "./retrieve-options.js";
import type {
  CreateGraphSearchToolOptions,
  GraphContext,
  GraphContextRetriever,
  GraphProperties,
  GraphSchemaLike,
  GraphSearchInput,
  GraphSearchTool,
} from "./types.js";

const DEFAULT_GRAPH_SEARCH_TOOL_DESCRIPTION =
  "Search the knowledge graph for relevant entities, relationships, and supporting source evidence.";

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

export function formatGraphContext(context: GraphContext): string {
  const sections: string[] = [];

  if (context.nodes.length > 0) {
    const lines = context.nodes.map((node) => {
      const props = formatPropertiesInline(node.properties);
      return props.length === 0
        ? `- [${node.type}] ${node.key}`
        : `- [${node.type}] ${node.key} (${props})`;
    });
    sections.push(`Entities:\n${lines.join("\n")}`);
  } else if (context.seeds.length > 0) {
    const lines = context.seeds.map((seed) => {
      const props = formatPropertiesInline(seed.properties);
      return props.length === 0
        ? `- [${seed.type}] ${seed.key}`
        : `- [${seed.type}] ${seed.key} (${props})`;
    });
    sections.push(`Seeds:\n${lines.join("\n")}`);
  }

  if (context.relationships.length > 0) {
    const lines = context.relationships.map((relationship) => {
      const props = formatPropertiesInline(relationship.properties);
      return props.length === 0
        ? `- ${relationship.from} -[${relationship.type}]-> ${relationship.to}`
        : `- ${relationship.from} -[${relationship.type} (${props})]-> ${relationship.to}`;
    });
    sections.push(`Relationships:\n${lines.join("\n")}`);
  }

  if (context.evidence.length > 0) {
    const lines = context.evidence.map(
      (chunk) => `[${chunk.documentId}#${chunk.index}] ${chunk.text}`,
    );
    sections.push(`Evidence:\n${lines.join("\n\n")}`);
  }

  return sections.length === 0 ? "No relevant graph context found." : sections.join("\n\n");
}

function formatPropertiesInline(props: GraphProperties): string {
  return Object.entries(props)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(", ");
}

export function createGraphSearchTool<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema>,
>(
  options: Omit<CreateGraphSearchToolOptions<Schema, Retriever, GraphContext>, "format"> & {
    format?: undefined;
  },
): GraphSearchTool<GraphContext>;
export function createGraphSearchTool<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema>,
  Formatted,
>(
  options: Omit<CreateGraphSearchToolOptions<Schema, Retriever, Formatted>, "format"> & {
    format: (context: GraphContext) => Formatted;
  },
): GraphSearchTool<Formatted>;
export function createGraphSearchTool<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema>,
  Formatted = GraphContext,
>(options: CreateGraphSearchToolOptions<Schema, Retriever, Formatted>): GraphSearchTool<Formatted> {
  const configuredTopK = options.search?.topK ?? DEFAULT_GRAPH_SEARCH_TOP_K;

  if (!Number.isSafeInteger(configuredTopK) || configuredTopK < 1) {
    throw new RangeError("Graph search topK must be a positive safe integer.");
  }

  const description = options.description ?? DEFAULT_GRAPH_SEARCH_TOOL_DESCRIPTION;
  const baseOptions = {
    name: options.name,
    description,
    inputSchema: z.object({
      query: z.string().min(1).describe("The question or concept to search for in the graph."),
      topK: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Optional maximum number of seed matches to retrieve (clamped to ${configuredTopK}).`,
        ),
    }),
  };

  const runRetrieve = async (
    query: string,
    topK: number | undefined,
    abortSignal?: AbortSignal,
  ) => {
    let search: GraphSearchInput | undefined = options.search;

    if (topK !== undefined) {
      const boundedTopK = Math.min(topK, configuredTopK);
      search =
        options.search === undefined
          ? { topK: boundedTopK }
          : { ...options.search, topK: boundedTopK };
    }

    return options.graph.retrieve({
      model: options.model,
      query,
      search,
      traversal: options.traversal,
      evidence: options.evidence,
      retries: options.retries,
      abortSignal,
    });
  };

  if (options.format !== undefined) {
    const format = options.format;
    return createTool({
      ...baseOptions,
      execute: async ({ query, topK }, context) =>
        format(await runRetrieve(query, topK, context.abortSignal)),
    }) as unknown as GraphSearchTool<Formatted>;
  }

  return createTool({
    ...baseOptions,
    outputSchema: contextSchema,
    execute: async ({ query, topK }, context) =>
      (await runRetrieve(query, topK, context.abortSignal)) as unknown as z.input<
        typeof contextSchema
      >,
  }) as unknown as GraphSearchTool<Formatted>;
}
