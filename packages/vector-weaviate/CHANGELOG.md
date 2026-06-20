# @anvia/weaviate

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
