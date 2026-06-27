---
title: "@anvia/fastembed: Usage Patterns"
description: "Common ways to compose @anvia/fastembed with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/fastembed"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

@anvia/fastembed owns local embedding generation. Application code owns source loading, chunking, metadata, indexing cadence, and storage.

Use the same embedding model for document ingestion and query-time search. If a different model or dimensionality is used later, rebuild the index rather than mixing vectors.

## Common composition

- Pair with `@anvia/core/embeddings` to turn records into embedded documents.
- Pair with `@anvia/core/vector-store` for local tests and prototypes.
- Pair with `@anvia/qdrant`, `@anvia/pgvector`, `@anvia/chroma`, or another vector adapter for persistent retrieval.

## Do and do not

Do batch inputs with the package options when indexing many documents. Do log the model name and dimension used for an index. Do keep source text and metadata stable enough to reproduce an index.

Do not generate embeddings inside the prompt path when they can be prepared ahead of time. Do not mix embedding models in one collection. Do not store secrets or tenant policy in embedding adapter configuration.
