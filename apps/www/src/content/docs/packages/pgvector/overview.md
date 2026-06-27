---
title: "@anvia/pgvector: Overview"
description: "Postgres pgvector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/pgvector"
  order: 1
  label: "Overview"
---
## What it is

Postgres pgvector store adapter for Anvia retrieval and semantic search.

Use @anvia/pgvector when the application needs Postgres with pgvector as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/pgvector stores embedded documents in Postgres with pgvector and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToPgVectorWhere`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `PgVectorStoreConnectOptions`, `PgVectorStore`, `PgVectorIndex`, `filterToPgVectorWhere`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/pgvector/getting-started)
- [Usage Patterns](/docs/packages/pgvector/usage-patterns)
- [Examples](/docs/packages/pgvector/examples)
- [Changelog](/docs/packages/pgvector/changelog)
- [Reference](/docs/packages/pgvector/reference)
