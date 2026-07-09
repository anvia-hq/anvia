---
title: "@anvia/memory-prisma: Examples"
description: "Small examples for Prisma-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-prisma"
  order: 4
  label: "Examples"
---
## Basic memory store

```ts
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

export const memory = createPrismaMemoryStore(prisma);
```

## Scoped support agent

```ts
import { AgentBuilder } from "@anvia/core";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";

export function createSupportAgent(scope: SupportScope) {
  return new AgentBuilder("support", scope.model)
    .instructions("Answer support questions using the durable conversation history.")
    .tools(scope.tools)
    .memory(
      createPrismaMemoryStore(scope.prisma, {
        scope: { metadataKeys: ["tenantId"] },
      }),
      { savePolicy: "turn" },
    )
    .build();
}
```

## Session run

```ts
const response = await agent
  .session(input.conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  })
  .prompt(input.message)
  .send();
```

## Load initial messages

```ts
export async function loadThread(input: LoadThreadInput) {
  const agent = createSupportAgent({
    model: input.model,
    prisma: input.prisma,
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
