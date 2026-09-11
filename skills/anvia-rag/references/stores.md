# Vector Store Selection

Core contracts live in `@anvia/core/vector-store`
(`InMemoryVectorStore`, `retrieveDocuments`, `vectorFilter`,
`createVectorSearchTool`). Durable backends live in adapter packages:

| Package           | Backend  | Best for                                  |
| ----------------- | -------- | ----------------------------------------- |
| `@anvia/chroma`   | Chroma   | local dev with persistence                |
| `@anvia/lancedb`  | LanceDB  | embedded local persistence, no server     |
| `@anvia/qdrant`   | Qdrant   | self-hosted production                    |
| `@anvia/pgvector` | pgvector | teams already on Postgres                 |
| `@anvia/milvus`   | Milvus   | large-scale self-hosted                   |
| `@anvia/pinecone` | Pinecone | managed production                        |
| `@anvia/redis`    | Redis    | existing Redis infra, hybrid search needs |
| `@anvia/weaviate` | Weaviate | managed / hybrid search features          |

For connected-entity questions (which incidents affect which products), add a
knowledge graph alongside the vector store — see `graph-rag.md`. Vectors find
similar text; graphs traverse relationships.

## Hybrid (dense + sparse) retrieval

Keyword-ish recall problems ("error 0x8007", exact identifiers) are a sparse
retrieval problem. `retrieveDocuments` has a hybrid overload — pass
`models: { dense, sparse }` instead of `model`, and the store's `searchHybrid`
fuses both rankings (`fusion` controls the strategy):

```ts
import { embedSparseQuery } from "@anvia/core/embeddings"; // SparseEmbeddingModel
// embedSparseTexts embeds documents' sparse side at ingestion

const results = await retrieveDocuments({
  store: hybridStore, // e.g. HybridVectorStore or a backend supporting searchHybrid
  query,
  models: { dense: embeddingModel, sparse: sparseModel },
  topK: 5,
});
```

Reach for hybrid when plain dense search misses exact tokens; keep pure dense
when it does not — hybrid adds an ingestion and store-compatibility cost.

## Client store pattern

```ts
import { ChromaVectorClient } from "@anvia/chroma";

const vectorClient = new ChromaVectorClient();
const store = vectorClient.vectorStore<Runbook>({
  collectionName: "anvia_runbooks",
  dimensions: 384, // must match the embedding model output
});
await store.ensure();
await store.upsert({ documents: embedded });
// ... retrieve ...
await vectorClient.close();
```

## Rules

- `dimensions` must match the embedding model — a 384-dim MiniLM index queried
  with another model's vectors fails silently on quality, not loudly on types.
- One model instance (or at least one model id) per collection. Never mix
  embedding models in the same collection.
- `ensure()` before `upsert`; `close()` clients when the process ends.
- Start with `InMemoryVectorStore.fromDocuments` for spikes and tests, then
  migrate to a client store — the `retrieveDocuments` call does not change.
