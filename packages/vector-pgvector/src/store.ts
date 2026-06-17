import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import pgvector from "pgvector";
import {
  defaultPgClient,
  pgVectorRows,
  quoteQualifiedIdentifier,
  validateTable,
} from "./helpers.js";
import { PgVectorIndex } from "./search-index.js";
import type { PgClientLike, PgVectorDistance, PgVectorStoreConnectOptions } from "./types.js";

export class PgVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: PgClientLike,
    private readonly tableName: string,
    private readonly distance: PgVectorDistance,
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: PgVectorStoreConnectOptions,
  ): Promise<PgVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultPgClient(options.connectionString));
    const tableName = quoteQualifiedIdentifier(options.tableName);
    const distance = options.distance ?? "cosine";

    if (options.createIfMissing !== false) {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (
  id text PRIMARY KEY,
  document_id text NOT NULL,
  document jsonb NOT NULL,
  metadata jsonb,
  embedding vector(${options.vectorSize}) NOT NULL
)`);
    }

    await validateTable(client, tableName, options.vectorSize);
    return new PgVectorStore<T, Metadata>(client, tableName, distance);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const rows = documents.flatMap((document) => pgVectorRows(document));
    if (rows.length === 0) {
      return;
    }

    const values = rows.flatMap((row) => [
      row.id,
      row.documentId,
      JSON.stringify(row.document),
      row.metadata === undefined ? null : JSON.stringify(row.metadata),
      pgvector.toSql(row.embedding),
    ]);
    const placeholders = rows.map((_, index) => {
      const offset = index * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4}::jsonb, $${
        offset + 5
      }::vector)`;
    });

    await this.client.query(
      `INSERT INTO ${this.tableName} (id, document_id, document, metadata, embedding)
VALUES ${placeholders.join(", ")}
ON CONFLICT (id) DO UPDATE SET
  document_id = EXCLUDED.document_id,
  document = EXCLUDED.document,
  metadata = EXCLUDED.metadata,
  embedding = EXCLUDED.embedding`,
      values,
    );
  }

  index(model: EmbeddingModel): PgVectorIndex<T, Metadata> {
    return new PgVectorIndex(model, this.client, this.tableName, this.distance);
  }
}
