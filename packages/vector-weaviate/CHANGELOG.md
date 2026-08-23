# @anvia/weaviate

## 1.0.1

### Patch Changes

- @anvia/core@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 927f81b: Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
  raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
  and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
  lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
  retries. Normalize provider scores so larger values are consistently better, return `topK` logical
  documents even when documents have multiple chunks, and require explicit Redis metadata indexing
  for filtered search.
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [07a1e6c]
- Updated dependencies [0292ede]
- Updated dependencies [007b132]
- Updated dependencies [c0c6cb8]
- Updated dependencies [a90416c]
- Updated dependencies [1dfb4f3]
- Updated dependencies [07a1e6c]
- Updated dependencies [8dc2dfb]
- Updated dependencies [6354116]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [9cb661c]
- Updated dependencies [1f6db5c]
- Updated dependencies [5ec61e3]
- Updated dependencies [5476f98]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [0292ede]
- Updated dependencies [4ab25bb]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5

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

## 0.2.5

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.2.4

### Patch Changes

- 433f642: Simplify optional vector query and result construction while preserving vector store behavior.

## 0.2.3

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.2.2

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.2.1

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.2.0

### Minor Changes

- 473af86: Add Weaviate, Redis, and LanceDB vector store adapters.

  - `@anvia/weaviate` -- Weaviate v3 client adapter with `collections` API and `nearVector` queries.
  - `@anvia/redis` -- Redis vector store using RediSearch `FT.CREATE`/`FT.SEARCH` with HNSW indexing.
  - `@anvia/lancedb` -- Embedded LanceDB adapter with columnar storage and SQL-like filters.
