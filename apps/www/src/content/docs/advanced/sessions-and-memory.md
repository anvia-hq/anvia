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

Core loads prior messages before the run and appends new runtime messages according to the configured save policy. Your application owns the `MemoryStore` implementation, authorization checks, retention policy, and tenant isolation.

## Memory Store Contract

A memory store implements three required operations. It can also implement `recordError(...)` for failed-run diagnostics:

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

## What To Store

Store the runtime messages needed for future model context: user prompts, assistant responses, assistant tool calls, and tool results. If a tool result includes sensitive data, apply your product retention and redaction policy before long-term persistence.

Memory is not the same as analytics or event replay. Use the event store for runtime events and observability for traces. Use memory for future prompts.

## Common Mistakes

Do not rebuild conversation history in every route handler. Do not concatenate old messages into a new prompt string. Do not persist only final assistant text when the run used tools, because the next turn may lose the tool result that explains the answer.

Keep session ids stable, scoped, and product-owned. A good session id identifies a product conversation, not a provider request.
