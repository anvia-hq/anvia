# @anvia/milvus

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
