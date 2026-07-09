---
title: "@anvia/memory-postgres: Overview"
description: "Postgres-backed durable session memory store for Anvia agents."
section: packages
sidebar:
  group: "@anvia/memory-postgres"
  order: 1
  label: "Overview"
---
## What it is

`@anvia/memory-postgres` stores Anvia agent session memory directly in Postgres.

Use it when an application wants durable memory without an ORM adapter, or when the product already owns a Postgres connection pool.

## Where it fits

The package implements core's `MemoryStore` interface. Core controls the save policy, while the Postgres adapter owns scope keys, ordered message rows, JSONB message storage, and failed-run error records.

## Public surface

The main exports are `createPostgresMemoryStore`, `PostgresMemoryStore`, `createPostgresMemorySchemaSql`, and `createPostgresMemoryScopeKey`.

## Next pages

- [Getting Started](/docs/packages/memory-postgres/getting-started)
- [Usage Patterns](/docs/packages/memory-postgres/usage-patterns)
- [Examples](/docs/packages/memory-postgres/examples)
- [Changelog](/docs/packages/memory-postgres/changelog)
- [Reference](/docs/packages/memory-postgres/reference)
