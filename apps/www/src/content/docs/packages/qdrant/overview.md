---
title: "@anvia/qdrant: Overview"
description: "Qdrant vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/qdrant"
  order: 1
  label: "Overview"
---
## What it is

Qdrant vector store adapter for Anvia retrieval and semantic search.

Use @anvia/qdrant when the application needs Qdrant as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/qdrant stores embedded documents in Qdrant and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToQdrantFilter`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `QdrantVectorStoreConnectOptions`, `QdrantVectorStore`, `QdrantVectorIndex`, `filterToQdrantFilter`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/qdrant/getting-started)
- [Usage Patterns](/docs/packages/qdrant/usage-patterns)
- [Examples](/docs/packages/qdrant/examples)
- [Changelog](/docs/packages/qdrant/changelog)
- [Reference](/docs/packages/qdrant/reference)
