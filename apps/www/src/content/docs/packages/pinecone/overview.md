---
title: "@anvia/pinecone: Overview"
description: "Pinecone vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/pinecone"
  order: 1
  label: "Overview"
---
## What it is

Pinecone vector store adapter for Anvia retrieval and semantic search.

Use @anvia/pinecone when the application needs Pinecone as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/pinecone stores embedded documents in Pinecone and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToPineconeFilter`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `PineconeVectorStoreConnectOptions`, `PineconeVectorStore`, `PineconeVectorIndex`, `filterToPineconeFilter`, `PineconeMetric`, `PineconeIndexLike`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/pinecone/getting-started)
- [Usage Patterns](/docs/packages/pinecone/usage-patterns)
- [Examples](/docs/packages/pinecone/examples)
- [Changelog](/docs/packages/pinecone/changelog)
- [Reference](/docs/packages/pinecone/reference)
