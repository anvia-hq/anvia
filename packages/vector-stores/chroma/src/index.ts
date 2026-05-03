import {
  createVectorSearchTool,
  type EmbeddedDocument,
  type EmbeddingModel,
  embedText,
  type Tool,
  type VectorFilter,
  type VectorMetadata,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core";

type ChromaClientLike = {
  getCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  createCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  getOrCreateCollection?(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
};

type ChromaCollectionLike = {
  upsert(options: Record<string, unknown>): Promise<unknown>;
  query(options: Record<string, unknown>): Promise<unknown>;
};

export type ChromaVectorStoreConnectOptions = {
  client?: ChromaClientLike | undefined;
  collectionName: string;
  createIfMissing?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  configuration?: Record<string, unknown> | undefined;
};

export class ChromaVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(private readonly collection: ChromaCollectionLike) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: ChromaVectorStoreConnectOptions,
  ): Promise<ChromaVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultChromaClient());
    const collectionOptions = {
      name: options.collectionName,
      metadata: options.metadata ?? { "hnsw:space": "cosine" },
      configuration: options.configuration,
      embeddingFunction: null,
    };
    const collection =
      options.createIfMissing === false
        ? await client.getCollection(collectionOptions)
        : client.getOrCreateCollection !== undefined
          ? await client.getOrCreateCollection(collectionOptions)
          : await getOrCreateCollection(client, collectionOptions);
    return new ChromaVectorStore<T, Metadata>(collection);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const records = documents.flatMap((document) => chromaRecords(document));
    await this.collection.upsert({
      ids: records.map((record) => record.id),
      documents: records.map((record) => record.document),
      embeddings: records.map((record) => record.embedding),
      ...(records.some((record) => record.metadata !== undefined)
        ? { metadatas: records.map((record) => record.metadata ?? null) }
        : {}),
    });
  }

  index(model: EmbeddingModel): ChromaVectorIndex<T, Metadata> {
    return new ChromaVectorIndex(model, this.collection);
  }
}

export class ChromaVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly collection: ChromaCollectionLike,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    const response = await this.collection.query({
      queryEmbeddings: [queryEmbedding.vector],
      nResults: request.topK,
      where: filterToChromaWhere(request.filter),
      include: ["documents", "metadatas", "distances"],
    });
    return parseQueryResults<T, Metadata>(response, request.threshold);
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}

export function filterToChromaWhere(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { [filter.key]: { $eq: filter.value } };
    case "gt":
      return { [filter.key]: { $gt: filter.value } };
    case "lt":
      return { [filter.key]: { $lt: filter.value } };
    case "and":
      return { $and: filter.filters.map(filterToChromaWhere) };
    case "or":
      return { $or: filter.filters.map(filterToChromaWhere) };
  }
}

async function defaultChromaClient(): Promise<ChromaClientLike> {
  const chroma = await import("chromadb");
  return new chroma.ChromaClient() as ChromaClientLike;
}

async function getOrCreateCollection(
  client: ChromaClientLike,
  options: Record<string, unknown>,
): Promise<ChromaCollectionLike> {
  try {
    return await client.getCollection(options);
  } catch {
    return await client.createCollection(options);
  }
}

function serializeDocument(document: unknown): string {
  return typeof document === "string" ? document : JSON.stringify(document);
}

function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const raw = response as {
    ids?: string[][];
    documents?: Array<Array<string | null>>;
    metadatas?: Array<Array<Metadata | null>>;
    distances?: number[][];
  };
  const ids = raw.ids?.[0] ?? [];
  const documents = raw.documents?.[0] ?? [];
  const metadatas = raw.metadatas?.[0] ?? [];
  const distances = raw.distances?.[0] ?? [];

  const results = ids.flatMap((id, index) => {
    const score = distanceToCosineScore(distances[index] ?? 0);
    if (threshold !== undefined && score < threshold) {
      return [];
    }
    return [
      {
        id: logicalDocumentId(id),
        score,
        document: parseDocument(documents[index]),
        ...(metadatas[index] === null || metadatas[index] === undefined
          ? {}
          : { metadata: metadatas[index] }),
      } as VectorSearchResult<T, Metadata>,
    ];
  });

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();
  for (const result of results) {
    if (!byId.has(result.id)) {
      byId.set(result.id, result);
    }
  }
  return [...byId.values()];
}

function distanceToCosineScore(distance: number): number {
  return 1 - distance;
}

function parseDocument<T>(document: string | null | undefined): T {
  if (document === null || document === undefined) {
    return "" as T;
  }
  try {
    return JSON.parse(document) as T;
  } catch {
    return document as T;
  }
}

function chromaRecords<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<{
  id: string;
  document: string;
  metadata: VectorMetadata | undefined;
  embedding: number[];
}> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }

  return document.embeddings.map((embedding, index) => ({
    id: document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`,
    document: serializeDocument(document.document),
    metadata: document.metadata,
    embedding: embedding.vector,
  }));
}

function logicalDocumentId(id: string): string {
  return id.replace(/#embedding:\d+$/, "");
}
