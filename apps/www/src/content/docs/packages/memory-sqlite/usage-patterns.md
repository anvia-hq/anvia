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

The default scope includes `sessionId` and `userId`; adding `metadataKeys: ["tenantId"]` to the store also includes `metadata.tenantId` in the database key:

```ts
const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
  scope: { metadataKeys: ["tenantId"] },
});
```

Set `includeUserId: false` only for intentionally shared tenant memory. Scope chooses which database rows to read and write; your app still owns authorization.

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

`initialMessages` hydrates browser state only. The stream route should still call `agent.session(...).prompt(latestUserMessage)` so SQLite memory loads authoritative history on the server.

## Migration ownership

The adapter creates its own tables by default. Set `createIfMissing: false` only when your app creates the SQLite schema through its own migration process.
