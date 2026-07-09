---
title: "@anvia/memory-drizzle: Overview"
description: "Drizzle-backed durable session memory store for Anvia agents."
section: packages
sidebar:
  group: "@anvia/memory-drizzle"
  order: 1
  label: "Overview"
---
## What it is

`@anvia/memory-drizzle` stores Anvia agent session memory through a Drizzle database instance.

The package exports the required Postgres Drizzle table definitions, so users can add Anvia memory tables to their Drizzle schema instead of copying table shapes by hand.

## Where it fits

The package implements core's `MemoryStore` interface. Core controls the save policy, while the Drizzle adapter owns scope keys, ordered message rows, JSONB message storage, and failed-run error records.

## Public surface

The main exports are `drizzleMemorySchema`, `agentMemorySessions`, `agentMemoryMessages`, `agentMemoryErrors`, `createDrizzleMemoryStore`, `DrizzleMemoryStore`, and `createDrizzleMemoryScopeKey`.

## Next pages

- [Getting Started](/docs/packages/memory-drizzle/getting-started)
- [Usage Patterns](/docs/packages/memory-drizzle/usage-patterns)
- [Examples](/docs/packages/memory-drizzle/examples)
- [Changelog](/docs/packages/memory-drizzle/changelog)
- [Reference](/docs/packages/memory-drizzle/reference)
