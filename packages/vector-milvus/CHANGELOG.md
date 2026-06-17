# @anvia/milvus

## 0.3.1

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.0

### Minor Changes

- ce25d82: Add Pinecone and Milvus vector store adapters following the existing pattern (Chroma, PgVector, Qdrant). Both implement the `VectorSearchIndex` interface with full filter translation, multi-embedding support, and `asTool()` integration.
