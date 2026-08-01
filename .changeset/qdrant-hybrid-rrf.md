---
"@anvia/core": minor
"@anvia/fastembed": minor
"@anvia/qdrant": minor
---

Add sparse embedding contracts and Qdrant hybrid RRF search.

Core gains `SparseVector` / `SparseEmbeddingModel`, plus `embedSparseTexts`, `embedSparseQuery`,
and `embedHybridDocuments`. `@anvia/fastembed` wraps FastEmbed SPLADE++. `@anvia/qdrant` supports
named dense+sparse collections and fused hybrid search via the same `index(...).search(...)` path.
