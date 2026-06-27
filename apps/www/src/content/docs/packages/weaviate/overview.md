---
title: "@anvia/weaviate: Overview"
description: "Weaviate vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/weaviate"
  order: 1
  label: "Overview"
---
## What it is

Weaviate vector store adapter for Anvia retrieval and semantic search.

Use @anvia/weaviate when the application needs Weaviate as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/weaviate stores embedded documents in Weaviate and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToWeaviateWhere`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `WeaviateVectorStoreConnectOptions`, `WeaviateVectorStore`, `WeaviateVectorIndex`, `filterToWeaviateWhere`, `WeaviateClientLike`, `WeaviateCollectionLike`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/weaviate/getting-started)
- [Usage Patterns](/docs/packages/weaviate/usage-patterns)
- [Examples](/docs/packages/weaviate/examples)
- [Changelog](/docs/packages/weaviate/changelog)
- [Reference](/docs/packages/weaviate/reference)
