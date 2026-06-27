---
title: "@anvia/chroma: Overview"
description: "ChromaDB vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/chroma"
  order: 1
  label: "Overview"
---
## What it is

ChromaDB vector store adapter for Anvia retrieval and semantic search.

Use @anvia/chroma when the application needs ChromaDB as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/chroma stores embedded documents in ChromaDB and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToChromaWhere`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `ChromaVectorStoreConnectOptions`, `ChromaVectorStore`, `ChromaVectorIndex`, `filterToChromaWhere`, `ChromaCollectionLike`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/chroma/getting-started)
- [Usage Patterns](/docs/packages/chroma/usage-patterns)
- [Examples](/docs/packages/chroma/examples)
- [Changelog](/docs/packages/chroma/changelog)
- [Reference](/docs/packages/chroma/reference)
