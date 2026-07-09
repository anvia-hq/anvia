---
title: Add memory
description: Persist conversation state and run agents against durable sessions.
section: basics
sidebar:
  group: Capabilities
  order: 3
---

Memory lets an agent load and save conversation history for a durable session.

## When to use this

Use memory when you want the agent to remember previous messages by `sessionId`. The stored messages are the conversation history the agent uses on future requests.

The first-class durable path is Prisma with `@anvia/memory-prisma`. Core still accepts any custom `MemoryStore`, but the Prisma package removes the need to design the table shape yourself.

## Prerequisites

Add memory after you have an agent that can answer prompts. The example below assumes your app already uses Prisma and owns its normal Prisma migration workflow.

## Install

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
```

## Generate the Prisma models

Run a dry run first:

```sh
npx @anvia/memory-prisma init
```

Then write the generated model file:

```sh
npx @anvia/memory-prisma init --write
```

By default this creates `prisma/models/anvia-memory.prisma`. If your project cannot use multi-file Prisma schemas, append to your existing schema explicitly:

```sh
npx @anvia/memory-prisma init --write --append-to-schema
```

The append path warns before writing because it modifies the existing `schema.prisma`.

After writing schema changes, validate and create a migration:

```sh
npx prisma validate
npx prisma migrate dev --name add_anvia_memory
```

## Create a memory store

```ts
import { AgentBuilder } from "@anvia/core";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

const memory = createPrismaMemoryStore(prisma, {
  scope: {
    metadataKeys: ["tenantId"],
  },
});

const agent = new AgentBuilder("assistant", model)
  .instructions("Remember durable session context.")
  .memory(memory, { savePolicy: "turn" })
  .build();
```

The `scope` option controls which stored conversation row a session uses. By default, the Prisma store scopes memory by `sessionId` and `userId`. `metadataKeys: ["tenantId"]` adds `metadata.tenantId` to that key, so two tenants can safely reuse the same conversation id without sharing memory.

Use stable product ids in scope values, such as tenant ids, workspace ids, or organization ids. Scope is storage isolation, not authorization; your route should still verify that the current user can access the session before calling the agent.

## Use a session

```ts
const session = agent.session("thread_123", {
  userId: "user_456",
  metadata: { tenantId: "tenant_789" },
});

await session.prompt("Remember that my project is named Anvia.").send();
const response = await session.prompt("What is my project named?").send();

console.log(response.output);
```

## What happens

The session loads prior history before the run and appends new messages as the run completes. `savePolicy: "turn"` stores complete model and tool turns together, which is usually the right default for product chat.

The Prisma store computes the same scope key on `load(...)`, `append(...)`, and `clear(...)`. If the session id, user id, or selected metadata values change, the agent is reading a different memory thread.

## Load messages for the UI

Memory is server-side state. When a user opens an existing thread, load the stored memory messages on the server and return them to the page:

```ts
export async function GET(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);

  const messages = await agent
    .session(params.threadId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .messages();

  return Response.json({ messages });
}
```

Those `messages` are core Anvia `Message[]`, not React UI messages. Convert them before passing them to `useChat`:

```tsx
import type { Message } from "@anvia/core";
import { initialMessagesFromMemory, useChat } from "@anvia/react";

export function ChatPage({
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

Use `initialMessages` only to hydrate browser state. The next POST should send the latest user message to `agent.session(...).prompt(...)`; the memory store will load prior history again on the server.

## Check yourself

Run both prompts with the same session id and confirm the second response can use information from the first prompt. Then inspect the generated Prisma tables and confirm the stored `message` values contain full Anvia message JSON, not only final assistant text.

## Next

Learn how session memory behaves in production.

[Sessions and memory](/docs/advanced/sessions-and-memory)
