---
title: Memory and Events
description: How agent memory and event stores differ, how each maps to database storage, and how they are used together in production.
section: examples
sidebar:
  group: Memory and Events
  label: Overview
  order: 0
---

Production agents often use both memory and event storage, but they solve different problems. Memory is conversation context for future prompts. Event storage is an operational log of what happened during one streamed run.

Do not merge them into one transcript table. A memory store answers "what should the model remember next time?" An event store answers "what happened during run `run_123`?"

## What Each Store Does

| Store | Key | Contract | Contains | Used for |
| --- | --- | --- | --- | --- |
| memory | `sessionId`, plus user or tenant scope | `MemoryStore.load(context): Promise<Message[]>` | ordered Anvia `Message[]` values | future prompts, durable conversations, `session.messages()` |
| event store | `runId` | `AgentEventStore.load(runId): Promise<AgentEventRecord[]>` | ordered stream events with raw `event` JSON | replay, debugging, audit review, operations views |

Memory is loaded before the next run and becomes model context. Event records are not loaded into prompts; they are inspected by humans, eval tooling, dashboards, or replay/debug flows.

## Production Layout

Keep these as separate storage paths:

| Data | Typical table | Why it exists |
| --- | --- | --- |
| memory sessions | `agent_memory_sessions` | owns product session scope, tenant/user ownership, lifecycle metadata, and cascade cleanup |
| memory messages | `agent_memory_messages` | gives the next prompt prior user, assistant, and tool-result messages |
| runtime events | `agent_events` | preserves turn starts, deltas, tool calls, tool results, nested agent events, final output, and errors by run id |
| product run record | `support_runs` or `agent_runs` | compact user-facing status, final output, trace id, and usage |
| audit records | `audit_logs` | records who requested or performed sensitive product actions |
| traces | tracing backend or trace id fields | connects the run to model/provider/tool observability |

Memory session rows are scoped by product-owned session, user, and tenant values. Memory message rows keep the ordered Anvia `Message` JSON used as future prompt context. Event rows are scoped by run id and agent metadata. Product run records usually connect both worlds by storing `conversationId`, `runId`, `traceId`, final output, and usage.

## Prisma Memory Setup

For a Prisma app, use `@anvia/memory-prisma` as the first-class memory adapter. It provides the store implementation and a safe schema generator, so the application does not have to design the Anvia memory tables by hand.

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
npx @anvia/memory-prisma init
npx @anvia/memory-prisma init --write
npx prisma validate
npx prisma migrate dev --name add_anvia_memory
```

Then create the memory store from your Prisma client:

```ts
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

export const memoryStore = createPrismaMemoryStore(prisma, {
  scope: {
    metadataKeys: ["tenantId"],
  },
});
```

The `scope` option defines the database identity for one memory thread. By default the key includes `sessionId` and `userId`; `metadataKeys: ["tenantId"]` also includes `metadata.tenantId`. That means `conversation_123` for `tenant_a` and `conversation_123` for `tenant_b` load different memory.

The store persists full Anvia messages. Product-facing conversation tables can still exist, but they should reference or summarize the agent session instead of replacing the memory store.

## Typical Flow

```ts
import { AgentBuilder } from "@anvia/core";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";

export function createSupportAgent(scope: SupportAgentScope) {
  const memoryStore = createPrismaMemoryStore(scope.prisma, {
    scope: { metadataKeys: ["tenantId"] },
  });

  return new AgentBuilder("support", scope.model)
    .instructions("Answer support questions using tools and policy context.")
    .tools(scope.tools)
    .memory(memoryStore, { savePolicy: "turn" })
    .eventStore(scope.eventStore, { include: "all" })
    .build();
}

export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportAgent({
    prisma: input.prisma,
    model: input.model,
    tools: input.tools,
    eventStore: input.eventStore,
  });

  let final;

  for await (const event of agent
    .session(input.conversationId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .prompt(input.message)
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .stream()) {
    if (event.type === "final") {
      final = event;
    }
  }

  if (final === undefined) {
    throw new Error("Agent stream ended without a final event.");
  }

  await input.runs.record({
    conversationId: input.conversationId,
    runId: final.runId,
    traceId: final.trace?.traceId,
    output: final.output,
    usage: final.usage,
  });

  return { output: final.output, runId: final.runId };
}
```

The memory store loads prior messages before the run and saves the completed turn. The event store records events while the stream is consumed. If you need replayable events, use `.stream()` and drain it even when your API only returns the final answer. Use `.send()` when the caller only needs the final response and event replay is not required.

## Loading Initial Messages

When the user opens an existing conversation, do not rebuild the transcript from event logs. Load the stored memory thread:

```ts
export async function loadSupportConversation(input: LoadConversationInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportAgent({
    prisma: input.prisma,
    model: input.model,
    tools: input.tools,
    eventStore: input.eventStore,
  });

  const messages = await agent
    .session(input.conversationId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .messages();

  return { messages };
}
```

Return those messages from a GET route as core Anvia `Message[]`. On the React page, convert them with `initialMessagesFromMemory(messages)` and pass the result to `useChat({ initialMessages })`. `initialMessages` is only UI hydration; future prompts should still go through the memory-backed session so the server can load authoritative history.

## Choosing The Adapter

Use Prisma as the default memory example when your app already uses Prisma:

| Need | First-class path | Notes |
| --- | --- | --- |
| durable memory with Prisma | [`@anvia/memory-prisma`](/docs/packages/memory-prisma) | Generates the Prisma models and implements `MemoryStore`. |
| durable memory with another database layer | [`@anvia/memory-drizzle`](/docs/packages/memory-drizzle), [`@anvia/memory-postgres`](/docs/packages/memory-postgres), or [`@anvia/memory-sqlite`](/docs/packages/memory-sqlite) | Use the package that matches the app's storage layer. |
| replayable runtime events with Prisma | [Prisma Agent Event Store](/docs/examples/agent-event-store-prisma) | Event stores are still app-owned because event indexing and retention usually follow product operations needs. |
| replayable runtime events with another database layer | [Drizzle Agent Event Store](/docs/examples/agent-event-store-drizzle) or [Raw SQL Agent Event Store](/docs/examples/agent-event-store-raw-sql) | Keep event storage separate from memory. |

The adapter choice should not change the runtime contract. Memory still returns `Message[]`; event storage still returns `AgentEventRecord[]`.

## Production Checks

- Keep memory, events, audit logs, traces, and product state in separate tables or services.
- Apply tenant and user scope to memory reads and writes.
- Store event payloads as JSON/JSONB and index `runId`, `agentId`, `turn`, and tool identifiers.
- Set retention and redaction policies for both memory and events; event payloads may include prompts, history, tool args, tool results, reasoning, provider metadata, and errors.
- Store a compact product run record for UI status instead of querying event logs for normal user-facing pages.
