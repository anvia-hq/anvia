# @anvia/pinecone

## 0.3.0

### Minor Changes

- ce25d82: Add Pinecone and Milvus vector store adapters following the existing pattern (Chroma, PgVector, Qdrant). Both implement the `VectorSearchIndex` interface with full filter translation, multi-embedding support, and `asTool()` integration.
