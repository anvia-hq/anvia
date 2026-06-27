---
title: "@anvia/weaviate: Usage Patterns"
description: "Common ways to compose @anvia/weaviate with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/weaviate"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

@anvia/weaviate owns persistence and search against Weaviate. Application code owns document loading, chunking, embedding, ingestion scheduling, tenant scoping, and when search results are allowed into model context.

The adapter exposes `search(...)`, `searchIds(...)`, `asTool(...)`, and optional inspection behavior through the Anvia vector-store contracts.

## Common composition

- Pair with `@anvia/core/embeddings` to create embedded documents before upsert.
- Pair with `@anvia/openai`, `@anvia/gemini`, `@anvia/fastembed`, or `@anvia/transformers` for embedding models.
- Pair with `AgentBuilder.dynamicContext(...)` when every prompt should receive retrieved context.
- Pair with `index.asTool(...)` when the model should decide whether to search.

## Do and do not

Do keep document ids stable across ingestion runs. Do apply metadata filters before results reach the prompt. Do keep vector dimensions aligned with the embedding model.

Do not let agents choose collection names or database credentials. Do not use vector search as the only authorization boundary. Do not assume inspection support exists in every production adapter.
