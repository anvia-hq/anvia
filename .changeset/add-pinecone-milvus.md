---
"@anvia/pinecone": minor
"@anvia/milvus": minor
---

Add Pinecone and Milvus vector store adapters following the existing pattern (Chroma, PgVector, Qdrant). Both implement the `VectorSearchIndex` interface with full filter translation, multi-embedding support, and `asTool()` integration.
