---
title: "@anvia/milvus: Overview"
description: "Milvus vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/milvus"
  order: 1
  label: "Overview"
---
## What it is

Milvus vector store adapter for Anvia retrieval and semantic search.

Use @anvia/milvus when the application needs Milvus as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/milvus stores embedded documents in Milvus and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToMilvusExpr`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `MilvusVectorStoreConnectOptions`, `MilvusVectorStore`, `MilvusVectorIndex`, `filterToMilvusExpr`, `MilvusMetric`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/milvus/getting-started)
- [Usage Patterns](/docs/packages/milvus/usage-patterns)
- [Examples](/docs/packages/milvus/examples)
- [Changelog](/docs/packages/milvus/changelog)
- [Reference](/docs/packages/milvus/reference)
