---
title: Sessions and memory
description: Persist conversation state across sessions and users.
section: advanced
sidebar:
  group: Agent runtime
  order: 13
  label: Memory
---

Sessions are the supported way to connect an agent run to durable conversation history. Configure memory on the agent, then run conversation turns through `agent.session(sessionId, options).prompt(input)`.

```ts
const agent = new AgentBuilder("support", model)
  .memory(memoryStore, { savePolicy: "turn" })
  .build();

const response = await agent
  .session("thread_123", {
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  })
  .prompt("Can you summarize my last invoice?")
  .send();
```

Core loads prior messages before the run and appends new runtime messages according to the configured save policy. Your application owns authentication, authorization checks, retention policy, and tenant isolation.

## Use Prisma First

For Prisma applications, use `@anvia/memory-prisma` instead of writing the `MemoryStore` table shape by hand.

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
npx @anvia/memory-prisma init
npx @anvia/memory-prisma init --write
npx prisma validate
npx prisma migrate dev --name add_anvia_memory
```

The init command is a dry run by default. `--write` creates `prisma/models/anvia-memory.prisma`. If your project cannot use multi-file Prisma schemas, use `--append-to-schema`; that path warns before modifying the existing `schema.prisma`.

```ts
import { AgentBuilder } from "@anvia/core";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

const memoryStore = createPrismaMemoryStore(prisma, {
  scope: {
    metadataKeys: ["tenantId"],
  },
});

export const supportAgent = new AgentBuilder("support", model)
  .instructions("Answer support questions using durable conversation context.")
  .memory(memoryStore, { savePolicy: "turn" })
  .build();
```

`scope` tells the adapter how to identify one durable memory thread in the database. The default key is `sessionId + userId`. `metadataKeys: ["tenantId"]` adds `context.metadata.tenantId`, producing a separate memory thread for each tenant even when conversation ids overlap.

Use stable ids for metadata scope values. Missing metadata keys become `null`, so make required tenancy metadata part of the request path before calling `agent.session(...)`. Scope prevents accidental row sharing; it does not replace authorization checks.

The Prisma store persists full Anvia `Message` JSON, maintains ordered message rows, stores failed-run diagnostics when enabled, and uses that scope key on memory load, append, clear, and error recording.

See [`@anvia/memory-prisma`](/docs/packages/memory-prisma/getting-started) for the full package guide.

## Other Store Packages

Use the memory package that matches your product database layer:

| Package | Use when |
| --- | --- |
| [`@anvia/memory-prisma`](/docs/packages/memory-prisma) | The app already uses Prisma and owns Prisma migrations. |
| [`@anvia/memory-drizzle`](/docs/packages/memory-drizzle) | The app uses Drizzle and wants exported Postgres table definitions. |
| [`@anvia/memory-postgres`](/docs/packages/memory-postgres) | The app owns a Postgres client or pool without an ORM. |
| [`@anvia/memory-sqlite`](/docs/packages/memory-sqlite) | The app needs local durable memory with SQLite. |

## Custom Memory Store Contract

Use a custom store only when the official packages do not fit your storage layer. A memory store implements three required operations. It can also implement `recordError(...)` for failed-run diagnostics:

```ts
import type { MemoryStore } from "@anvia/core";

export const memoryStore: MemoryStore = {
  async load(context) {
    return readStoredSessionMessages(context.sessionId, context.userId);
  },
  async append(input) {
    await appendMessages({
      sessionId: input.context.sessionId,
      userId: input.context.userId,
      runId: input.runId,
      turn: input.turn,
      messages: input.messages,
    });
  },
  async clear(context) {
    await clearStoredSessionMessages(context.sessionId, context.userId);
  },
  // Optional. Omit this method if failed runs do not need separate audit records.
  async recordError(input) {
    await recordFailedRun(input.context.sessionId, input.runId, input.error);
  },
};
```

Use `context.metadata` for safe routing data such as tenant id, region, or product surface. Do not trust the session id alone for authorization.

## Save Policies

Memory supports three save policies:

- `"message"` writes each user, assistant, and tool message as soon as it is produced.
- `"turn"` batches the messages created during a completed turn.
- `"run"` writes the messages from the run only after the run completes.

`"message"` is the default and gives the most incremental durability. `"turn"` is a good production default when you want complete model-tool turns. `"run"` is useful for workflows where partial runs should not become conversation context.

Failed runs can call `recordError` when your store implements it. Use that for diagnostics and recovery records without treating partial output as normal conversation memory.

## Session Operations

Use `session.messages()` when a product or internal surface needs to show the current stored transcript:

```ts
const session = agent.session("thread_123", { userId: user.id });
const messages = await session.messages();
```

Use `session.clear()` for product flows such as clearing a conversation, retention cleanup, or test setup:

```ts
await agent.session("thread_123", { userId: user.id }).clear();
```

Both operations go through the configured memory store. The store should enforce the same user and tenant rules as your product database.

## Serve Stored Messages To React

Production UIs usually need one route to load saved messages and another route to stream the next turn. Store core Anvia `Message[]` on the server, return those messages from your API, then convert them with `initialMessagesFromMemory(...)` before passing them to `useChat({ initialMessages })`.

The flow has two separate parts:

1. `GET /threads/:threadId/messages` calls `agent.session(...).messages()` and returns `{ messages }`.
2. The React page calls `initialMessagesFromMemory(messages)` and passes the result to `useChat({ initialMessages })`.

```ts
import { AgentBuilder, type Message } from "@anvia/core";
import { type UIStreamRequest } from "@anvia/core/ui";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { createEventStream } from "@anvia/server";
import { prisma } from "./db";

function sessionScope(user: { id: string; tenantId: string }) {
  return {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  };
}

function createSupportAgent(user: { id: string; tenantId: string }) {
  const memory = createPrismaMemoryStore(prisma, {
    scope: { metadataKeys: ["tenantId"] },
  });

  return new AgentBuilder("support", model)
    .instructions("Answer support questions with durable conversation context.")
    .memory(memory, { savePolicy: "turn" })
    .build();
}

function latestUserMessage(messages: Message[]): Message {
  const message = messages.at(-1);
  if (message?.role !== "user") {
    throw new Error("Expected the latest chat message to be from the user.");
  }
  return message;
}

export async function GET(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);
  const agent = createSupportAgent(user);
  const messages = await agent.session(params.threadId, sessionScope(user)).messages();

  return Response.json({ messages });
}
```

The GET route returns core memory messages exactly as they are stored by the memory adapter:

```ts
type LoadMessagesResponse = {
  messages: Message[];
};
```

On the client, convert that API payload into React UI messages before creating the chat controller:

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

The stream route remains separate:

```ts

export async function POST(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);
  const agent = createSupportAgent(user);
  const body = (await request.json()) as UIStreamRequest;

  return createEventStream(
    agent
      .session(params.threadId, sessionScope(user))
      .prompt(latestUserMessage(body.messages))
      .stream(),
  );
}
```

The loaded memory messages are API data. `initialMessagesFromMemory(...)` converts core `Message[]` into `UIMessage[]` for browser rendering. It does not write memory, and it does not change what the model sees.

The POST route should use the latest user message with `agent.session(...).prompt(...)`; the configured `MemoryStore` loads prior history server-side. Do not send the full hydrated transcript back as the session prompt. See [React UI persistence](/docs/react-ui/persistence) for the client-side `initialMessages` pattern.

## What To Store

Store the runtime messages needed for future model context: user prompts, assistant responses, assistant tool calls, and tool results. If a tool result includes sensitive data, apply your product retention and redaction policy before long-term persistence.

Memory is not the same as analytics or event replay. Use the event store for runtime events and observability for traces. Use memory for future prompts.

## Common Mistakes

Do not rebuild conversation history in every route handler. Do not concatenate old messages into a new prompt string. Do not persist only final assistant text when the run used tools, because the next turn may lose the tool result that explains the answer.

Keep session ids stable, scoped, and product-owned. A good session id identifies a product conversation, not a provider request.
