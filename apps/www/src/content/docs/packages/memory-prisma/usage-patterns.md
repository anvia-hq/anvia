---
title: "@anvia/memory-prisma: Usage Patterns"
description: "Common ways to use Prisma-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-prisma"
  order: 3
  label: "Usage Patterns"
---
## Tenant-scoped conversations

Pass stable product conversation ids to `agent.session(...)`, user ids through `userId`, and tenant or workspace ids through selected metadata keys.

```ts
const memory = createPrismaMemoryStore(prisma, {
  scope: { metadataKeys: ["tenantId"] },
});

const session = agent.session(conversation.id, {
  userId: user.id,
  metadata: { tenantId: user.tenantId },
});
```

The scope key isolates memory by conversation, user, and tenant.

## Save policy

Use `.memory(memory, { savePolicy: "turn" })` for product chat when a complete model/tool turn should be saved together. Use `"message"` for incremental durability or `"run"` when partial runs must not become future context.

## Custom Prisma model names

The default store expects `AgentMemorySession`, `AgentMemoryMessage`, and `AgentMemoryError` models. Use `PrismaMemoryStore.fromDelegates(...)` when your app maps those tables to different Prisma model names.

## Migration ownership

The init CLI writes Prisma model definitions only. It does not run `db push`, apply migrations, or deploy migrations. Keep migration review and deployment in the same workflow as the rest of your Prisma schema.
