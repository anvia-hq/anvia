import {
  createContextSource,
  type ContextSource,
  type Document,
  type RetrySetting,
} from "@anvia/core";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import { formatGraphContext } from "./tool.js";
import type {
  GraphContext,
  GraphContextRetriever,
  GraphEvidenceInputFor,
  GraphSchemaLike,
  GraphSearchInput,
  GraphTraversalInput,
} from "./types.js";

export type CreateGraphContextOptions<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema> = GraphContextRetriever<Schema>,
> = Readonly<{
  id?: string | undefined;
  graph: Retriever;
  model: EmbeddingModel;
  search?: GraphSearchInput | undefined;
  traversal?: GraphTraversalInput<Schema> | undefined;
  evidence?: GraphEvidenceInputFor<Retriever["evidenceCapability"]> | undefined;
  retries?: RetrySetting | undefined;
  format?: ((context: GraphContext) => readonly Document[]) | undefined;
}>;

export function createGraphContext<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema>,
>(options: CreateGraphContextOptions<Schema, Retriever>): ContextSource {
  const documentId = options.id ?? "graph-context";
  const format =
    options.format ??
    ((context: GraphContext): readonly Document[] => {
      if (
        context.seeds.length === 0 &&
        context.nodes.length === 0 &&
        context.relationships.length === 0 &&
        context.evidence.length === 0
      ) {
        return [];
      }

      return [
        {
          id: documentId,
          text: formatGraphContext(context),
        },
      ];
    });

  return createContextSource(async ({ query, abortSignal }) => {
    const context = await options.graph.retrieve({
      model: options.model,
      query,
      search: options.search,
      traversal: options.traversal,
      evidence: options.evidence,
      retries: options.retries,
      abortSignal,
    });
    return format(context);
  });
}
