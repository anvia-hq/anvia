# @anvia/memgraph

## 1.2.0

### Minor Changes

- ae40e82: Improve developer experience across RAG, vector stores, embeddings, and knowledge graph packages with progressive defaults while retaining full low-level control:

  - **Core RAG (`@anvia/core`)**: default recursive chunking (`strategy`, `maxSize`, `separators`), zero-boilerplate `embedDocuments` overloads for strings and `{ text }` documents, plain-object metadata filter shorthand (`{ key: value }` / `{ key: { gt, in, ... } }`), default `topK = 5`, reranking hook (`rerank` + `candidateTopK`), hybrid and chunk-granularity support in `ingestVectorDocuments`, `VectorStore.delete()` + `matchedText`, `ContextSource` for custom dynamic agent context, clean `TextDocument` formatting in `VectorContext`, and the high-level `createVectorIndex()` facade.
  - **Local embeddings (`@anvia/transformers`)**: default `loadTransformersEmbeddingModel()` to `DEFAULT_TRANSFORMERS_EMBEDDING_MODEL`.
  - **Vector adapters (`@anvia/pgvector`, `@anvia/qdrant`, `@anvia/pinecone`, `@anvia/chroma`, `@anvia/lancedb`, `@anvia/milvus`, `@anvia/redis`, `@anvia/weaviate`)**: add `delete({ documentIds })` and `[Symbol.asyncDispose]()` across all adapters.
  - **Knowledge graphs (`@anvia/graph`, `@anvia/neo4j`, `@anvia/memgraph`)**: compile-time validation for node `identity` and relationship `from`/`to`, auto-strictening of plain `z.object()` schemas, optional `relationships` and relationship `properties`, `onInvalidFact: "warn"` and `onProgress` callbacks, default ingestion conflict/orphan policies, bounded default retrieval options (supporting empty `relationships: []`), `formatGraphContext()`, `createGraphContext()`, `createKnowledgeGraph()`, derived managed graph resource defaults + default `ensure()` timeout in Neo4j/Memgraph, `"dotProduct"` similarity parity in Memgraph, unified `defineGraphSchema`/`extractGraphFacts` exports in Neo4j, and fix Memgraph retrieval when `model.dimensions` is omitted.

### Patch Changes

- Updated dependencies [ae40e82]
  - @anvia/graph@1.3.0

## 1.1.10

### Patch Changes

- 59b308b: Update runtime dependencies to their latest compatible minor and patch releases.

## 1.1.9

### Patch Changes

- 81ed4ab: Scope entity and relationship identity matches to the managed graph so two graphs that share label resources cannot overwrite each other's nodes.
- 0fcd493: Scope graph exploration to the managed graph so overview and expansion do not return nodes from another graph that shares label resources.
  - @anvia/graph@1.2.0

## 1.1.8

### Patch Changes

- 3409ac2: Reject NUL bytes in identifiers. `quoteIdentifier` now throws for a name containing `\u0000`, matching `@anvia/neo4j`, so a schema or resource name cannot smuggle a control character into generated Cypher.
- Updated dependencies [b5c7820]
  - @anvia/graph@1.2.0

## 1.1.7

### Patch Changes

- cae22f9: Update runtime dependencies to their latest compatible minor and patch releases.

## 1.1.6

### Patch Changes

- 46e6f4f: Update upstream runtime dependencies to their latest releases, including `@anthropic-ai/sdk` and `@anthropic-ai/vertex-sdk` 1.x, `@mistralai/mistralai` 3.x and `@langfuse/otel` and `@langfuse/tracing` 6.x. The `zod` peer range is now `^4.6.7`. `@anvia/jev` adapts to `@typesafe-ai/sdk` 0.7, which no longer accepts a `null` state.
- Updated dependencies [46e6f4f]
  - @anvia/graph@1.1.6

## 1.1.5

### Patch Changes

- a32e40c: Refresh package READMEs with concise product overviews, current quickstarts, and links to detailed guides. Publish the updated documentation on npm.
- Updated dependencies [a32e40c]
  - @anvia/graph@1.1.5

## 1.1.4

### Patch Changes

- Updated dependencies [8a873c8]
  - @anvia/graph@1.1.4

## 1.1.3

### Patch Changes

- 0d9bce0: Declare compatible workspace peer ranges so additive internal dependency releases do not force major releases of dependents.
- Updated dependencies [0d9bce0]
  - @anvia/graph@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [f998fd6]
  - @anvia/core@1.1.2
  - @anvia/graph@1.1.2

## 1.1.1

### Patch Changes

- f48bb95: Bump upstream runtime dependencies to their latest versions and align zod to 4.5.4 across all packages and workspaces.
- Updated dependencies [f48bb95]
  - @anvia/core@1.1.1
  - @anvia/graph@1.1.1

## 1.0.12

### Patch Changes

- Updated dependencies [2277090]
  - @anvia/core@1.0.10
  - @anvia/graph@1.0.12

## 1.0.11

### Patch Changes

- Updated dependencies [68953da]
  - @anvia/core@1.0.9
  - @anvia/graph@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [0891239]
  - @anvia/graph@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [18344a2]
  - @anvia/core@1.0.8
  - @anvia/graph@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [9e5e068]
  - @anvia/core@1.0.7
  - @anvia/graph@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [32cffc0]
  - @anvia/core@1.0.6
  - @anvia/graph@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/core@1.0.5
  - @anvia/graph@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4
  - @anvia/graph@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3
  - @anvia/graph@1.0.4

## 1.0.3

### Patch Changes

- 5ca833e: Add provider-neutral knowledge graph primitives, a schema-first Memgraph GraphRAG adapter, and
  graph-bound retrieval for portable Neo4j and Memgraph applications. Standardize Agent integration
  on the shared `createGraphSearchTool()` factory with evidence-aware typing. Add bounded graph
  exploration to both adapters and a searchable, expandable graph explorer in Studio.
- Updated dependencies [5ca833e]
  - @anvia/graph@1.0.3
