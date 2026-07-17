---
title: "@anvia/memory-sqlite: Overview"
description: "SQLite-backed durable session memory store for Anvia agents."
section: packages
sidebar:
  group: "@anvia/memory-sqlite"
  order: 1
  label: "Overview"
---
## What it is

`@anvia/memory-sqlite` stores Anvia agent session memory in SQLite using Node's built-in `node:sqlite` driver.

Use it for local apps, desktop apps, examples, prototypes, or small deployments that need durable memory without an external database service.

## Where it fits

The package implements core's `MemoryStore` interface. Core controls the save policy, while the SQLite adapter owns the local tables, scope keys, ordered message rows, message JSON storage, and failed-run error records. Its read-only `MemoryInspector` lets Studio discover existing database conversations without copying them or changing the schema.

## Public surface

The main exports are `createSqliteMemoryStore`, `SqliteMemoryStore`, and `createSqliteMemoryScopeKey`.

## Next pages

- [Getting Started](/docs/packages/memory-sqlite/getting-started)
- [Usage Patterns](/docs/packages/memory-sqlite/usage-patterns)
- [Examples](/docs/packages/memory-sqlite/examples)
- [Changelog](/docs/packages/memory-sqlite/changelog)
- [Reference](/docs/packages/memory-sqlite/reference)
