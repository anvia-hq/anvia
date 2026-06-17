import { type EmbeddingModel, embedText, type VectorMetadata } from "@anvia/core/embeddings";
import type { Tool } from "@anvia/core/tool";
import {
  createVectorSearchTool,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core/vector-store";
import pgvector from "pgvector";
import { filterToPgVectorWhere } from "./filters.js";
import { distanceOperator, normalizedTopK, parseSearchRows } from "./helpers.js";
import type { PgClientLike, PgVectorDistance } from "./types.js";

export class PgVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly client: PgClientLike,
    private readonly tableName: string,
    private readonly distance: PgVectorDistance,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    const operator = distanceOperator(this.distance);
    const where = filterToPgVectorWhere(request.filter, 2);
    const limitParameter = 2 + (where?.values.length ?? 0);
    const response = await this.client.query(
      `SELECT id, document_id, document, metadata, embedding ${operator} $1::vector AS distance
FROM ${this.tableName}
${where === undefined ? "" : `WHERE ${where.sql}`}
ORDER BY embedding ${operator} $1::vector
LIMIT $${limitParameter}`,
      [
        pgvector.toSql(queryEmbedding.vector),
        ...(where?.values ?? []),
        normalizedTopK(request.topK),
      ],
    );

    return parseSearchRows<T, Metadata>(
      response.rows as Array<{
        id: string;
        document_id: string;
        document: unknown;
        metadata: Metadata | null;
        distance: number | string;
      }>,
      request.threshold,
      this.distance,
    );
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}
