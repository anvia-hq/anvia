import {
  type EmbeddingModel,
  embedSparseQuery,
  embedText,
  type SparseEmbeddingModel,
  type VectorMetadata,
} from "@anvia/core/embeddings";
import type { Tool } from "@anvia/core/tool";
import {
  createVectorSearchTool,
  type VectorInspectPage,
  type VectorInspectRequest,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core/vector-store";
import { filterToQdrantFilter } from "./filters.js";
import { parseQueryResults, qdrantDocumentPage } from "./helpers.js";
import type { QdrantClientLike, QdrantFusion } from "./types.js";

export type QdrantVectorIndexHybridOptions = {
  sparse: SparseEmbeddingModel;
  fusion: QdrantFusion;
  denseVectorName: string;
  sparseVectorName: string;
  prefetchLimit?: number | undefined;
};

export class QdrantVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
    private readonly hybrid?: QdrantVectorIndexHybridOptions | undefined,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    if (this.hybrid === undefined) {
      const queryEmbedding = await embedText(this.model, request.query);
      const filter = filterToQdrantFilter(request.filter);
      const response =
        typeof this.client.query === "function"
          ? await this.client.query(this.collectionName, {
              query: queryEmbedding.vector,
              limit: request.topK,
              filter,
              score_threshold: request.threshold,
              with_payload: true,
            })
          : typeof this.client.search === "function"
            ? await this.client.search(this.collectionName, {
                vector: queryEmbedding.vector,
                limit: request.topK,
                filter,
                score_threshold: request.threshold,
                with_payload: true,
              })
            : (() => {
                throw new TypeError(
                  "Qdrant search requires a client that implements query(...) or search(...).",
                );
              })();
      return parseQueryResults<T, Metadata>(response, request.threshold);
    }

    if (typeof this.client.query !== "function") {
      throw new TypeError("Hybrid Qdrant search requires a client that implements query(...).");
    }

    const prefetchLimit = Math.max(
      request.topK,
      Math.trunc(this.hybrid.prefetchLimit ?? request.topK * 5),
    );
    const [denseEmbedding, sparseEmbedding] = await Promise.all([
      embedText(this.model, request.query),
      embedSparseQuery(this.hybrid.sparse, request.query),
    ]);

    const response = await this.client.query(this.collectionName, {
      prefetch: [
        {
          query: denseEmbedding.vector,
          using: this.hybrid.denseVectorName,
          limit: prefetchLimit,
          filter: filterToQdrantFilter(request.filter),
        },
        {
          query: {
            indices: sparseEmbedding.vector.indices,
            values: sparseEmbedding.vector.values,
          },
          using: this.hybrid.sparseVectorName,
          limit: prefetchLimit,
          filter: filterToQdrantFilter(request.filter),
        },
      ],
      query: { fusion: this.hybrid.fusion },
      limit: request.topK,
      score_threshold: request.threshold,
      with_payload: true,
    });
    return parseQueryResults<T, Metadata>(response, request.threshold);
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  async inspect(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>> {
    return qdrantDocumentPage<T, Metadata>(this.client, this.collectionName, {
      ...request,
      filter: filterToQdrantFilter(request.filter),
    });
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}
