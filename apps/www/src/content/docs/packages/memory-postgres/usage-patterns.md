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

The default scope includes `sessionId` and `userId`; metadata keys add product tenancy or workspace isolation. The adapter reads selected keys from `context.metadata`, so the matching session call must pass the same values:

```ts
const session = agent.session(conversation.id, {
  userId: user.id,
  metadata: { tenantId: user.tenantId },
});
```

Set `includeUserId: false` only for intentionally shared tenant memory. Scope chooses which database rows to read and write; your app still owns authorization.

## Load initial messages

Use `session.messages()` on the server when a React page needs to render an existing thread:

```ts
export async function GET(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);
  const agent = await createSupportAgent(user);

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

`initialMessages` hydrates browser state only. The stream route should still call `agent.session(...).prompt(latestUserMessage)` so Postgres memory loads authoritative history on the server.

## Table names

Use `tablePrefix` for simple naming changes, or `tableNames` for explicit names.

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  tablePrefix: "app_",
});
```
