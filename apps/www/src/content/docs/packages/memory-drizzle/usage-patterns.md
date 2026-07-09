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

`initialMessages` hydrates browser state only. The stream route should still call `agent.session(...).prompt(latestUserMessage)` so Drizzle memory loads authoritative history on the server.

## Advisory locking

Append and failed-run writes use Postgres advisory locks by default through `db.execute(...)`. Set `lock: "none"` only when your deployment serializes same-scope writes another way.
