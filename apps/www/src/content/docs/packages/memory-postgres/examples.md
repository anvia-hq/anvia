---
title: "@anvia/memory-postgres: Examples"
description: "Small examples for Postgres-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-postgres"
  order: 4
  label: "Examples"
---
## Basic memory store

```ts
import { createPostgresMemoryStore } from "@anvia/memory-postgres";

export const memory = await createPostgresMemoryStore({
  connectionString: process.env.DATABASE_URL,
});
```

## Migration-owned schema

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  createIfMissing: false,
});
```

## Scoped agent

```ts
const agent = new AgentBuilder("support", model)
  .memory(
    await createPostgresMemoryStore({
      client: pool,
      scope: { metadataKeys: ["tenantId"] },
    }),
    { savePolicy: "turn" },
  )
  .build();
```

## Load initial messages

```ts
export async function loadThread(input: LoadThreadInput) {
  const agent = await createSupportAgent({
    model: input.model,
    pool: input.pool,
    tools: input.tools,
  });

  const messages = await agent
    .session(input.conversationId, {
      userId: input.user.id,
      metadata: { tenantId: input.user.tenantId },
    })
    .messages();

  return { messages };
}
```

```tsx
import type { Message } from "@anvia/core";
import { initialMessagesFromMemory, useChat } from "@anvia/react";

export function ThreadPage({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: Message[];
}) {
  const chat = useChat({
    endpoint: `/api/conversations/${conversationId}/chat`,
    initialMessages: initialMessagesFromMemory(messages),
  });

  return <ChatProvider controller={chat}>{/* thread */}</ChatProvider>;
}
```
