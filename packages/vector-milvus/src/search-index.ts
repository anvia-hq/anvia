import { type EmbeddingModel, embedText, type VectorMetadata } from "@anvia/core/embeddings";
import type { Tool } from "@anvia/core/tool";
import {
  createVectorSearchTool,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core/vector-store";
import { filterToMilvusExpr } from "./filters.js";
import { parseQueryResults } from "./helpers.js";
import { documentFieldName, documentIdFieldName, type MilvusClientLike } from "./types.js";

export class MilvusVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly client: MilvusClientLike,
    private readonly collectionName: string,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    const filterExpr = filterToMilvusExpr(request.filter);
    const options: Record<string, unknown> = {
      collection_name: this.collectionName,
      vector: [queryEmbedding.vector],
      limit: request.topK,
      output_fields: [documentIdFieldName, documentFieldName, "*"],
    };
    if (filterExpr !== undefined) {
      options.filter = filterExpr;
    }
    const response = await this.client.search(options);
    return parseQueryResults<T, Metadata>(response, request.threshold);
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}
