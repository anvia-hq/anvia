---
title: "@anvia/transformers: Overview"
description: "Transformers.js embedding model adapter for local Anvia embedding workflows."
section: packages
sidebar:
  group: "@anvia/transformers"
  order: 1
  label: "Overview"
---
## What it is

Transformers.js embedding model adapter for local Anvia embedding workflows.

Use @anvia/transformers when the application needs local embeddings that can feed Anvia vector stores or retrieval tools. It is one of the embedding adapters that create vectors before indexing or retrieval.

## Where it fits

@anvia/transformers returns an `EmbeddingModel` compatible with `@anvia/core/embeddings`. Use the same model for indexing and querying so vector dimensions stay consistent.

The package owns local feature-extraction embeddings through Transformers.js. Keep document chunking, source metadata, ingestion scheduling, and vector-store selection in application code.

## Public surface

The main documented exports are `DEFAULT_TRANSFORMERS_EMBEDDING_MODEL`, `Transformers Types`, `TransformersEmbeddingModel`, `createTransformersEmbeddingModel`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/transformers/getting-started)
- [Usage Patterns](/docs/packages/transformers/usage-patterns)
- [Examples](/docs/packages/transformers/examples)
- [Changelog](/docs/packages/transformers/changelog)
- [Reference](/docs/packages/transformers/reference)
