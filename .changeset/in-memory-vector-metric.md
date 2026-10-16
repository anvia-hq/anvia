---
"@anvia/core": minor
---

Add a `metric` option (`"cosine" | "euclidean" | "dotProduct"`) to `InMemoryVectorStore`. Cosine remains the default. Euclidean scores are negated distances (nearest first, `minScore` acts as a negative distance threshold), matching the pgvector, Chroma, LanceDB, and Milvus adapters.
