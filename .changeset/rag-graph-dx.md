---
"@anvia/core": minor
"@anvia/durable": patch
"@anvia/studio": patch
"@anvia/transformers": minor
"@anvia/chroma": minor
"@anvia/lancedb": minor
"@anvia/milvus": minor
"@anvia/pgvector": minor
"@anvia/pinecone": minor
"@anvia/qdrant": minor
"@anvia/redis": minor
"@anvia/weaviate": minor
"@anvia/graph": minor
"@anvia/neo4j": minor
"@anvia/memgraph": minor
---

Improve developer experience across RAG, vector stores, embeddings, and knowledge graph packages with progressive defaults while retaining full low-level control:

- **Core RAG (`@anvia/core`)**: default recursive chunking (`strategy`, `maxSize`, `separators`), zero-boilerplate `embedDocuments` overloads for strings and `{ text }` documents, plain-object metadata filter shorthand (`{ key: value }` / `{ key: { gt, in, ... } }`), default `topK = 5`, reranking hook (`rerank` + `candidateTopK`), hybrid and chunk-granularity support in `ingestVectorDocuments`, `VectorStore.delete()` + `matchedText`, `ContextSource` for custom dynamic agent context, clean `TextDocument` formatting in `VectorContext`, and the high-level `createVectorIndex()` facade.
- **Local embeddings (`@anvia/transformers`)**: default `loadTransformersEmbeddingModel()` to `DEFAULT_TRANSFORMERS_EMBEDDING_MODEL`.
- **Vector adapters (`@anvia/pgvector`, `@anvia/qdrant`, `@anvia/pinecone`, `@anvia/chroma`, `@anvia/lancedb`, `@anvia/milvus`, `@anvia/redis`, `@anvia/weaviate`)**: add `delete({ documentIds })` and `[Symbol.asyncDispose]()` across all adapters.
- **Knowledge graphs (`@anvia/graph`, `@anvia/neo4j`, `@anvia/memgraph`)**: compile-time validation for node `identity` and relationship `from`/`to`, auto-strictening of plain `z.object()` schemas, optional `relationships` and relationship `properties`, `onInvalidFact: "warn"` and `onProgress` callbacks, default ingestion conflict/orphan policies, bounded default retrieval options (supporting empty `relationships: []`), `formatGraphContext()`, `createGraphContext()`, `createKnowledgeGraph()`, derived managed graph resource defaults + default `ensure()` timeout in Neo4j/Memgraph, `"dotProduct"` similarity parity in Memgraph, unified `defineGraphSchema`/`extractGraphFacts` exports in Neo4j, and fix Memgraph retrieval when `model.dimensions` is omitted.
