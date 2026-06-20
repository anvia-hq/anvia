---
"@anvia/anthropic": patch
"@anvia/chroma": patch
"@anvia/fastembed": patch
"@anvia/gemini": patch
"@anvia/langfuse": patch
"@anvia/lancedb": patch
"@anvia/logger": patch
"@anvia/milvus": patch
"@anvia/mistral": patch
"@anvia/openai": patch
"@anvia/otel": patch
"@anvia/pgvector": patch
"@anvia/pinecone": patch
"@anvia/qdrant": patch
"@anvia/redis": patch
"@anvia/sandbox": patch
"@anvia/studio": patch
"@anvia/transformers": patch
"@anvia/weaviate": patch
---

Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.
