import { z } from "zod";
import {
  cosineSimilarity,
  type EmbeddedDocument,
  type Embedding,
  type EmbeddingModel,
  embedText,
  type VectorMetadata,
} from "../embeddings";
import { createTool } from "../tool/create-tool";
import type { Tool } from "../tool/tool";
import { matchesVectorFilter, type VectorFilter } from "./filter";
import { LshIndex, type LshOptions } from "./lsh";

export { type VectorFilter, vectorFilter } from "./filter";

export type IndexStrategy = { type: "bruteForce" } | LshOptions;

export type VectorSearchRequest = {
  query: string;
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
};

export type VectorSearchResult<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  score: number;
  id: string;
  document: T;
  metadata?: Metadata | undefined;
};

export type VectorInspectRequest = {
  limit: number;
  cursor?: string | undefined;
  filter?: VectorFilter | undefined;
};

export type VectorInspectItem<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  document: T;
  metadata?: Metadata | undefined;
};

export type VectorInspectPage<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  items: Array<VectorInspectItem<T, Metadata>>;
  nextCursor?: string | undefined;
  totalCount?: number | undefined;
};

export interface VectorSearchIndex<T = unknown, Metadata extends VectorMetadata = VectorMetadata> {
  search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
  searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>>;
  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown>;
  inspect?(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>>;
}

export type VectorSearchToolOptions = {
  name: string;
  description?: string | undefined;
  topK?: number | undefined;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
};

type StoredDocument<T, Metadata extends VectorMetadata> = EmbeddedDocument<T, Metadata>;

export class InMemoryVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private readonly documents = new Map<string, StoredDocument<T, Metadata>>();
  private indexStrategy: IndexStrategy;
  private lshIndex: LshIndex | undefined;
  private embeddingDimension: number | undefined;

  constructor(options: { index?: IndexStrategy } = {}) {
    this.indexStrategy = options.index ?? { type: "bruteForce" };
  }

  static fromDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
    documents: Array<EmbeddedDocument<T, Metadata>>,
    options: { index?: IndexStrategy } = {},
  ): InMemoryVectorStore<T, Metadata> {
    const store = new InMemoryVectorStore<T, Metadata>(options);
    store.addDocuments(documents);
    return store;
  }

  addDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): this {
    this.validateDocumentDimensions(documents);
    for (const document of documents) {
      this.documents.set(document.id, document);
    }
    this.rebuildLshIndex();
    return this;
  }

  get(id: string): StoredDocument<T, Metadata> | undefined {
    return this.documents.get(id);
  }

  values(): Array<StoredDocument<T, Metadata>> {
    return [...this.documents.values()];
  }

  len(): number {
    return this.documents.size;
  }

  isEmpty(): boolean {
    return this.documents.size === 0;
  }

  index(model: EmbeddingModel): InMemoryVectorIndex<T, Metadata> {
    return new InMemoryVectorIndex(model, this);
  }

  candidates(queryEmbedding: Embedding): Array<StoredDocument<T, Metadata>> {
    this.validateQueryDimension(queryEmbedding);
    if (this.indexStrategy.type !== "lsh" || this.lshIndex === undefined) {
      return this.values();
    }

    const candidateIds = this.lshIndex.query(queryEmbedding.vector);
    if (candidateIds.size === 0) {
      return this.values();
    }

    return [...candidateIds].flatMap((id) => {
      const document = this.documents.get(id);
      return document === undefined ? [] : [document];
    });
  }

  private rebuildLshIndex(): void {
    if (this.indexStrategy.type !== "lsh") {
      this.lshIndex = undefined;
      return;
    }

    const firstEmbedding = this.values().flatMap((document) => document.embeddings)[0];
    if (firstEmbedding === undefined) {
      this.lshIndex = undefined;
      return;
    }

    const index = new LshIndex(firstEmbedding.vector.length, this.indexStrategy);
    for (const document of this.documents.values()) {
      for (const embedding of document.embeddings) {
        index.insert(document.id, embedding.vector);
      }
    }
    this.lshIndex = index;
  }

  private validateDocumentDimensions(documents: Array<EmbeddedDocument<T, Metadata>>): void {
    let dimension = this.embeddingDimension;
    for (const document of documents) {
      for (const embedding of document.embeddings) {
        dimension = validateEmbeddingDimension(dimension, embedding, document.id);
      }
    }
    this.embeddingDimension = dimension;
  }

  private validateQueryDimension(queryEmbedding: Embedding): void {
    if (this.embeddingDimension === undefined) {
      return;
    }
    validateEmbeddingDimension(this.embeddingDimension, queryEmbedding, "query");
  }
}

export class InMemoryVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly store: InMemoryVectorStore<T, Metadata>,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    return this.store
      .candidates(queryEmbedding)
      .filter((document) => matchesVectorFilter(document.metadata, request.filter))
      .flatMap((document) => {
        const score = bestScore(queryEmbedding, document.embeddings);
        if (score === undefined) {
          return [];
        }
        if (request.threshold !== undefined && score < request.threshold) {
          return [];
        }
        return [
          {
            score,
            id: document.id,
            document: document.document,
            ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
          },
        ];
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(0, Math.trunc(request.topK)));
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  async inspect(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>> {
    const limit = Math.max(0, Math.trunc(request.limit));
    const start = Math.max(0, Math.trunc(Number(request.cursor ?? "0")));
    const documents = this.store
      .values()
      .filter((document) => matchesVectorFilter(document.metadata, request.filter));
    const page = documents.slice(start, start + limit);
    const nextOffset = start + page.length;
    return {
      items: page.map((document) => ({
        id: document.id,
        document: document.document,
        ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
      })),
      ...(nextOffset < documents.length ? { nextCursor: String(nextOffset) } : {}),
      totalCount: documents.length,
    };
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}

export function createVectorSearchTool<T, Metadata extends VectorMetadata>(
  index: VectorSearchIndex<T, Metadata>,
  options: VectorSearchToolOptions,
): Tool<{ query: string; topK?: number }, Array<VectorSearchResult<T, Metadata>>> {
  return createTool({
    name: options.name,
    description:
      options.description ?? "Search a vector store for documents relevant to the provided query.",
    input: z.object({
      query: z.string().describe("The query string to search for relevant documents."),
      topK: z.number().int().positive().optional().describe("The maximum number of results."),
    }),
    output: z.array(
      z.object({
        score: z.number(),
        id: z.string(),
        document: z.any(),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      }),
    ),
    execute: ({ query, topK }) =>
      index.search({
        query,
        topK: topK ?? options.topK ?? 5,
        threshold: options.threshold,
        filter: options.filter,
      }),
  }) as Tool<{ query: string; topK?: number }, Array<VectorSearchResult<T, Metadata>>>;
}

function bestScore(queryEmbedding: Embedding, embeddings: Embedding[]): number | undefined {
  let best: number | undefined;
  for (const embedding of embeddings) {
    const score = cosineSimilarity(queryEmbedding.vector, embedding.vector);
    best = best === undefined ? score : Math.max(best, score);
  }
  return best;
}

function validateEmbeddingDimension(
  expectedDimension: number | undefined,
  embedding: Embedding,
  id: string,
): number {
  if (expectedDimension === undefined) {
    return embedding.vector.length;
  }
  if (embedding.vector.length !== expectedDimension) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimension} dimensions but received ${embedding.vector.length} for ${id}`,
    );
  }
  return expectedDimension;
}
