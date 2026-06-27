---
title: "@anvia/redis: Overview"
description: "Redis vector store adapter for Anvia retrieval and semantic search."
section: packages
sidebar:
  group: "@anvia/redis"
  order: 1
  label: "Overview"
---
## What it is

Redis vector store adapter for Anvia retrieval and semantic search.

Use @anvia/redis when the application needs Redis Stack with RediSearch as the backing store for embedded documents and semantic search. It is one of the storage adapters that expose a provider-neutral VectorSearchIndex.

## Where it fits

@anvia/redis stores embedded documents in Redis Stack with RediSearch and returns indexes that implement `VectorSearchIndex`. Agents can use the index as dynamic context or as a search tool without depending on the database client.

The package owns connection setup, document upsert, metadata filter translation through `filterToRedisQuery`, and search result mapping. Keep document loading, chunking, embedding model choice, tenant scoping, and ingestion jobs in application code.

## Public surface

The main documented exports are `RedisVectorStoreConnectOptions`, `RedisVectorStore`, `RedisVectorIndex`, `filterToRedisQuery`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/redis/getting-started)
- [Usage Patterns](/docs/packages/redis/usage-patterns)
- [Examples](/docs/packages/redis/examples)
- [Changelog](/docs/packages/redis/changelog)
- [Reference](/docs/packages/redis/reference)
