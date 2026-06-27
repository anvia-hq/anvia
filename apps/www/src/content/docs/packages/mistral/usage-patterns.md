---
title: "@anvia/mistral: Usage Patterns"
description: "Common ways to compose @anvia/mistral with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/mistral"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

@anvia/mistral owns the provider adapter. It should be created at the model boundary, then passed into `@anvia/core` as a completion, embedding, transcription, audio, image, OCR, or listing model where that package supports it.

Keep prompts, tools, memory, retrieval, tenant routing, and fallback policy outside the provider adapter. That makes it possible to swap providers without rewriting agent or pipeline code.

## Common composition

- Pair with `@anvia/core` for agents, direct completions, extractors, and pipelines.
- Pair with `@anvia/server` and `@anvia/react` when exposing streamed runs to a browser UI.
- Pair with `@anvia/logger`, `@anvia/langfuse`, or `@anvia/otel` when provider calls need operational visibility.
- Pair provider embeddings with a vector-store package for RAG ingestion and search.

## Do and do not

Do construct `MistralClient` once per runtime boundary or request scope. Do record selected provider and model in logs or traces. Do pass provider-specific options through the model request only when the behavior is intentionally provider-specific.

Do not import provider SDK types throughout product code. Do not put API keys in browser bundles. Do not hide fallback behavior inside the agent prompt; make model selection explicit and testable.
