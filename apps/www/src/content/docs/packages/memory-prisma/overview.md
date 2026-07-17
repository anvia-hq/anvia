---
title: "@anvia/memory-prisma: Overview"
description: "Prisma-backed durable session memory store for Anvia agents."
section: packages
sidebar:
  group: "@anvia/memory-prisma"
  order: 1
  label: "Overview"
---
## What it is

`@anvia/memory-prisma` stores Anvia agent session memory in a Prisma-managed database.

Use it when the app already owns conversations through Prisma and you want `.session(...).prompt(...)` to load and append durable Anvia `Message[]` values without hand-writing a `MemoryStore`.

## Where it fits

The package implements core's `MemoryStore` interface. Core still controls when messages are saved through the configured save policy, while the Prisma adapter owns scope keys, ordered message rows, full message JSON storage, and failed-run error records. It also exposes core's read-only `MemoryInspector`, allowing Studio to discover existing conversations without copying them or changing the schema.

The app still owns authentication, tenant checks, Prisma migrations, retention policy, and any user-facing conversation records.

## Public surface

The main exports are `createPrismaMemoryStore`, `PrismaMemoryStore`, `createPrismaMemoryScopeKey`, and Prisma delegate/configuration types. The package also ships `npx @anvia/memory-prisma init` to generate the required Prisma models safely.

## Next pages

- [Getting Started](/docs/packages/memory-prisma/getting-started)
- [Usage Patterns](/docs/packages/memory-prisma/usage-patterns)
- [Examples](/docs/packages/memory-prisma/examples)
- [Changelog](/docs/packages/memory-prisma/changelog)
- [Reference](/docs/packages/memory-prisma/reference)
