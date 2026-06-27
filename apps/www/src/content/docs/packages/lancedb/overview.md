---
title: "@anvia/lancedb: Overview"
description: "LanceDB vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/lancedb"
  order: 1
  label: "Overview"
---
## What it is

LanceDB vector store adapter for Anvia retrieval and semantic search.

Use @anvia/lancedb when the application needs LanceDB as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/lancedb stores embedded documents in LanceDB and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToLanceExpr`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `LanceDBVectorStoreConnectOptions`, `LanceDBVectorStore`, `LanceDBVectorIndex`, `filterToLanceExpr`, `LanceDBConnectionLike`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/lancedb/getting-started)
- [Usage Patterns](/docs/packages/lancedb/usage-patterns)
- [Examples](/docs/packages/lancedb/examples)
- [Changelog](/docs/packages/lancedb/changelog)
- [Reference](/docs/packages/lancedb/reference)
