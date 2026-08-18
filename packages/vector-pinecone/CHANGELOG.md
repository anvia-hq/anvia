# @anvia/pinecone

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 927f81b: Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
  raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
  and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
  lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
  retries. Normalize provider scores so larger values are consistently better, return `topK` logical
  documents even when documents have multiple chunks, and require explicit Redis metadata indexing
  for filtered search.
- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [1f6db5c]
- Updated dependencies [5476f98]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.3.8

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.3.7

### Patch Changes

- 433f642: Simplify optional vector query and result construction while preserving vector store behavior.

## 0.3.6

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.3.5

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.4

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.2

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.1

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.0

### Minor Changes

- ce25d82: Add Pinecone and Milvus vector store adapters following the existing pattern (Chroma, PgVector, Qdrant). Both implement the `VectorSearchIndex` interface with full filter translation, multi-embedding support, and `asTool()` integration.
