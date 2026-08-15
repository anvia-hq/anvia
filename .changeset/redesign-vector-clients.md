---
"@anvia/core": patch
"@anvia/studio": patch
"@anvia/chroma": patch
"@anvia/lancedb": patch
"@anvia/milvus": patch
"@anvia/pgvector": patch
"@anvia/pinecone": patch
"@anvia/qdrant": patch
"@anvia/redis": patch
"@anvia/weaviate": patch
"@anvia/fastembed": patch
"@anvia/transformers": patch
"@anvia/openai": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
---

Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
retries. Normalize provider scores so larger values are consistently better, return `topK` logical
documents even when documents have multiple chunks, and require explicit Redis metadata indexing
for filtered search.
