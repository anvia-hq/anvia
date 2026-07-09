---
title: "@anvia/memory-drizzle: Examples"
description: "Small examples for Drizzle-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-drizzle"
  order: 4
  label: "Examples"
---
## Schema export

```ts
import { drizzleMemorySchema } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
  users,
  conversations,
};
```

## Basic memory store

```ts
import { createDrizzleMemoryStore } from "@anvia/memory-drizzle";

export const memory = createDrizzleMemoryStore(db);
```

## Scoped agent

```ts
const agent = new AgentBuilder("support", model)
  .memory(
    createDrizzleMemoryStore(db, {
      scope: { metadataKeys: ["tenantId"] },
    }),
    { savePolicy: "turn" },
  )
  .build();
```

## Load initial messages

```ts
export async function loadThread(input: LoadThreadInput) {
  const agent = createSupportAgent({
    db: input.db,
    model: input.model,
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
