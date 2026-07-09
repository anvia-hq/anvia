---
title: "@anvia/memory-drizzle: Usage Patterns"
description: "Common ways to use Drizzle-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-drizzle"
  order: 3
  label: "Usage Patterns"
---
## Exported table definitions

Use `drizzleMemorySchema` when you want all memory tables:

```ts
export const schema = {
  ...drizzleMemorySchema,
};
```

Use individual table exports when your schema file groups tables manually:

```ts
export { agentMemorySessions, agentMemoryMessages, agentMemoryErrors };
```

## Tenant-scoped conversations

```ts
const memory = createDrizzleMemoryStore(db, {
  scope: { metadataKeys: ["tenantId"] },
});
```

The default scope includes `sessionId` and `userId`; metadata keys add product tenancy or workspace isolation.

## Advisory locking

Append and failed-run writes use Postgres advisory locks by default through `db.execute(...)`. Set `lock: "none"` only when your deployment serializes same-scope writes another way.
