---
title: "@anvia/memory-sqlite: Usage Patterns"
description: "Common ways to use SQLite-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-sqlite"
  order: 3
  label: "Usage Patterns"
---
## Local durable memory

Use a file path for durable local memory:

```ts
const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
});
```

Use the default `:memory:` path for tests or short-lived examples.

## Tenant-scoped conversations

Pass product conversation ids to `agent.session(...)`, user ids through `userId`, and tenant ids through selected metadata keys.

```ts
const session = agent.session(conversation.id, {
  userId: user.id,
  metadata: { tenantId: user.tenantId },
});
```

## Migration ownership

The adapter creates its own tables by default. Set `createIfMissing: false` only when your app creates the SQLite schema through its own migration process.
