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

The scope key isolates memory by conversation, user, and tenant. Internally the adapter builds one stable key from `sessionId`, `userId`, and each selected metadata value.

If the same `sessionId` should be shared across users inside a tenant, opt out of user scoping explicitly:

```ts
const memory = createPrismaMemoryStore(prisma, {
  scope: {
    includeUserId: false,
    metadataKeys: ["tenantId"],
  },
});
```

Use that only for intentional shared memory. For normal user conversations, keep the default `includeUserId: true`.

Metadata keys can point at nested JSON values:

```ts
const memory = createPrismaMemoryStore(prisma, {
  scope: { metadataKeys: ["tenant.id", "workspace.id"] },
});
```

Missing metadata values become `null`, so validate required tenancy metadata before running the session. Scope is not an authorization layer; it only decides which stored rows the memory adapter reads and writes.

## Custom scope keys

Pass a function when the app already has one canonical database key for conversation memory:

```ts
const memory = createPrismaMemoryStore(prisma, {
  scope: (context) => {
    const tenantId = context.metadata?.tenantId;
    return `${tenantId}:${context.sessionId}`;
  },
});
```

The function must return the same value for every request that should share memory, including `load(...)`, `append(...)`, and `clear(...)`.

## Load initial messages

Use `session.messages()` on the server when a React page needs to render an existing thread:

```ts
export async function GET(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);
  const agent = createSupportAgent(user);

  const messages = await agent
    .session(params.threadId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .messages();

  return Response.json({ messages });
}
```

The response contains core Anvia `Message[]`. Convert those messages before passing them to `useChat`:

```tsx
import type { Message } from "@anvia/core";
import { initialMessagesFromMemory, useChat } from "@anvia/react";

export function SupportChat({
  threadId,
  messages,
}: {
  threadId: string;
  messages: Message[];
}) {
  const chat = useChat({
    endpoint: `/api/threads/${threadId}/chat`,
    initialMessages: initialMessagesFromMemory(messages),
  });

  return <ChatProvider controller={chat}>{/* thread */}</ChatProvider>;
}
```

`initialMessages` hydrates browser state only. The stream route should still call `agent.session(...).prompt(latestUserMessage)` so Prisma memory loads authoritative history on the server.

## Save policy

Use `.memory(memory, { savePolicy: "turn" })` for product chat when a complete model/tool turn should be saved together. Use `"message"` for incremental durability or `"run"` when partial runs must not become future context.

## Custom Prisma model names

The default store expects `AgentMemorySession`, `AgentMemoryMessage`, and `AgentMemoryError` models. Use `PrismaMemoryStore.fromDelegates(...)` when your app maps those tables to different Prisma model names.

Studio discovery remains optional for custom delegates. Provide `findMany(...)` and
`findUnique(...)` on the sessions delegate, plus the normal messages `findMany(...)` delegate, to
expose the read-only inspector. Existing custom delegates without those session read methods keep
working for agent memory and appear as unavailable in Studio's Memory page.

## Migration ownership

The init CLI writes Prisma model definitions only. It does not run `db push`, apply migrations, or deploy migrations. Keep migration review and deployment in the same workflow as the rest of your Prisma schema.
