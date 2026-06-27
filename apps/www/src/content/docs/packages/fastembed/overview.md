---
title: "@anvia/fastembed: Overview"
description: "FastEmbed embedding model adapter for local Anvia embedding and retrieval workflows."
section: packages
sidebar:
  group: "@anvia/fastembed"
  order: 1
  label: "Overview"
---
## What it is

FastEmbed embedding model adapter for local Anvia embedding and retrieval workflows.

Use @anvia/fastembed when the application needs local embeddings that can feed Anvia vector stores or retrieval tools. It is one of the embedding adapters that create vectors before indexing or retrieval.

## Where it fits

@anvia/fastembed returns an `EmbeddingModel` compatible with `@anvia/core/embeddings`. Use the same model for indexing and querying so vector dimensions stay consistent.

The package owns local text embedding generation through FastEmbed. Keep document chunking, source metadata, ingestion scheduling, and vector-store selection in application code.

## Public surface

The main documented exports are `DEFAULT_FASTEMBED_EMBEDDING_MODEL`, `FastEmbed Types`, `FastEmbedEmbeddingModel`, `createFastEmbedEmbeddingModel`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/fastembed/getting-started)
- [Usage Patterns](/docs/packages/fastembed/usage-patterns)
- [Examples](/docs/packages/fastembed/examples)
- [Changelog](/docs/packages/fastembed/changelog)
- [Reference](/docs/packages/fastembed/reference)
