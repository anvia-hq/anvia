---
title: "Qdrant"
description: "Public exports from @anvia/qdrant."
section: packages
sidebar:
  group: "qdrant"
  order: 6
  label: "Qdrant"
---
Import from `@anvia/qdrant`.

## QdrantVectorStoreConnectOptions

```ts
type QdrantDistance = "Cosine" | "Dot" | "Euclid";
type QdrantFusion = "rrf" | "dbsf";

type QdrantVectorStoreConnectOptions = {
  client?: QdrantClientLike;
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean;
  distance?: QdrantDistance;
  hybrid?: boolean;
  denseVectorName?: string;
  sparseVectorName?: string;
};
```

Purpose: connection options for a Qdrant collection.

Return behavior: consumed by `QdrantVectorStore.connect(...)`. Dense-only collections use an
unnamed vector config. `hybrid: true` creates named dense + sparse vectors for RRF search.

Notable errors: missing collections reject when `createIfMissing` is `false`; collection creation requires `vectorSize`.

Design note: `connect(...)` performs async collection lookup or creation before returning a store. This keeps constructors synchronous and side-effect free while making connection and configuration failures happen before ingestion or search.

## QdrantVectorStore

```ts
type QdrantHybridIndexOptions = {
  dense: EmbeddingModel;
  sparse: SparseEmbeddingModel;
  fusion?: QdrantFusion;
  denseVectorName?: string;
  sparseVectorName?: string;
  prefetchLimit?: number;
};

class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  static connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreConnectOptions,
  ): Promise<QdrantVectorStore<T, Metadata>>;
  upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void>;
  index(model: EmbeddingModel): QdrantVectorIndex<T, Metadata>;
  index(options: QdrantHybridIndexOptions): QdrantVectorIndex<T, Metadata>;
}
```

Purpose: Qdrant-backed document storage.

Return behavior: `connect(...)` resolves a store; `index(denseModel)` binds dense-only search;
`index({ dense, sparse })` binds hybrid RRF search when the collection was created with
`hybrid: true`.

Notable errors: connection and upsert calls reject on Qdrant errors; `upsertDocuments(...)` throws when a document has no embeddings, hybrid upserts lack aligned `sparseEmbeddings`, or metadata uses reserved `__anvia_*` keys. Mixing dense-only and hybrid index modes throws.

## QdrantVectorIndex

```ts
class QdrantVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata> {
  search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
  searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>>;
  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown>;
}
```

Purpose: query-time Qdrant search adapter.

Return behavior: embeds the query, calls Qdrant (`search` for dense-only or `query` with
prefetch + RRF for hybrid), deduplicates multi-embedding document IDs, and returns normalized
results. The search request shape stays `{ query, topK, filter?, threshold? }`.

Notable errors: embedding or Qdrant query failures reject. Hybrid search requires a client that
implements `query(...)`.

## filterToQdrantFilter

```ts
function filterToQdrantFilter(filter: VectorFilter | undefined): unknown;
```

Purpose: convert Anvia vector filters to Qdrant payload filters.

Return behavior: returns `undefined` when no filter is supplied.

Notable errors: none directly.
