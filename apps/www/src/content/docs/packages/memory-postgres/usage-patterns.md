---
title: "@anvia/memory-postgres: Usage Patterns"
description: "Common ways to use Postgres-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-postgres"
  order: 3
  label: "Usage Patterns"
---
## Existing pg pool

Pass an existing `pg` pool or checked-out client:

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  createIfMissing: false,
});
```

Append and error writes run inside a transaction. When the adapter receives a pool-like client, it checks out one transaction client before issuing `BEGIN`.

## Tenant-scoped conversations

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  scope: { metadataKeys: ["tenantId"] },
});
```

The default scope includes `sessionId` and `userId`; metadata keys add product tenancy or workspace isolation.

## Table names

Use `tablePrefix` for simple naming changes, or `tableNames` for explicit names.

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  tablePrefix: "app_",
});
```
