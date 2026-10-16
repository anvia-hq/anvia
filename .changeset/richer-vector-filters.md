---
"@anvia/core": minor
"@anvia/chroma": minor
"@anvia/milvus": minor
"@anvia/pgvector": minor
"@anvia/pinecone": minor
"@anvia/qdrant": minor
"@anvia/redis": minor
"@anvia/weaviate": minor
"@anvia/cli": patch
---

Add richer vector metadata filters. `VectorFilter` now supports `ne`, `in`, `gte`, and `lte`, and `and`/`or` accept any non-empty list of child filters (existing two-element filters keep working). `vectorFilter` gains matching builders, and `and(...)`/`or(...)` are variadic. The in-memory store and LanceDB post-filtering evaluate the new operators, and the Chroma, Milvus, PgVector, Pinecone, Qdrant, Redis, and Weaviate adapters translate them to native operators, throwing a descriptive error for combinations a backend cannot express. The bundled `anvia-rag` skill documents the new operators.
