---
title: "Memory"
description: "Durable session memory interfaces and save-policy contracts."
section: packages
sidebar:
  group: "Reference"
  order: 15
  label: "Memory"
---
Import from `@anvia/core` or `@anvia/core/memory`.

## MemoryStore

```ts
interface MemoryStore {
  readonly inspector?: MemoryInspector;
  load(context: MemoryContext): Promise<Message[]>;
  append(input: MemoryAppendInput): Promise<void>;
  clear(context: MemoryContext): Promise<void>;
  recordError?(input: MemoryErrorInput): Promise<void>;
}
```

Purpose: application-owned persistence adapter for durable agent sessions.

Return behavior: `load(...)` returns prior transcript messages for a session; `append(...)` persists new run messages; `clear(...)` deletes the session transcript; `recordError(...)` optionally receives partial run messages when a prompt run fails.

Notable errors: store implementations should reject when persistence fails. Rejections from `load(...)`, `append(...)`, `clear(...)`, or `recordError(...)` surface through session prompt calls.

## MemoryInspector and Conversation Types

```ts
interface MemoryInspector {
  listConversations(
    options: MemoryConversationListOptions,
  ): Promise<MemoryConversationSummary[]>;
  getConversation(ref: string): Promise<MemoryConversation | undefined>;
}

type MemoryConversationListOptions = {
  limit: number;
  userId?: string;
};

type MemoryConversationSummary = {
  ref: string;
  sessionId: string;
  userId?: string;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type MemoryConversationMessage = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string;
  message: Message;
};

type MemoryConversation = MemoryConversationSummary & {
  messages: MemoryConversationMessage[];
};
```

Purpose: optional read-only discovery for developer tools such as Studio. `ref` is an opaque
store-specific row reference, while `sessionId` remains the product conversation identifier.
Custom stores do not need to implement this capability.

Return behavior: implementations list newest conversations first and return messages in storage
position order. Inspection does not import, copy, clear, or otherwise mutate product memory.

## MemoryContext

```ts
type MemoryContext = {
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};
```

Purpose: identifies the conversation scope loaded and saved by a `MemoryStore`.

Return behavior: passed to every store method. `sessionId` comes from `agent.session(sessionId, options?)`; `userId` and `metadata` come from `SessionOptions`.

Notable errors: `agent.session(...)` rejects empty session ids before creating a `MemoryContext`.

## MemoryAppendInput and MemoryErrorInput

```ts
type MemoryAppendInput = {
  context: MemoryContext;
  runId: string;
  turn: number;
  messages: Message[];
};

type MemoryErrorInput = {
  context: MemoryContext;
  runId: string;
  error: unknown;
  messages: Message[];
};
```

Purpose: structured inputs for normal message persistence and failure recording.

Return behavior: `messages` contains the transcript messages Anvia is asking the store to persist for that save point. `runId` and `turn` let stores group messages by run or model/tool loop turn.

Notable errors: none directly; store implementations decide how to handle duplicate or partially persisted messages.

## MemoryOptions

```ts
type MemorySavePolicy = "message" | "turn" | "run";

type MemoryOptions = {
  savePolicy?: MemorySavePolicy | undefined;
};

type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
};

function resolveMemoryOptions(options?: MemoryOptions): ResolvedMemoryOptions;
```

Purpose: configures when `AgentSession` appends messages to the configured store.

Return behavior: `resolveMemoryOptions(...)` fills the default `savePolicy: "message"`. `AgentBuilder.memory(store, options?)` stores the resolved policy in `MemoryRegistration`.

Notable errors: none directly.

| Policy | Behavior |
| --- | --- |
| `"message"` | Save completed user, assistant, and tool-result messages as they become available. |
| `"turn"` | Save completed messages after each model/tool loop turn. |
| `"run"` | Save only after a successful final response. |

## Registration and Session Types

```ts
type MemoryRegistration = {
  store: MemoryStore;
  options: ResolvedMemoryOptions;
};

type SessionOptions = {
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};
```

Purpose: internal agent configuration and per-session metadata contracts.

Return behavior: `MemoryRegistration` is created by `AgentBuilder.memory(...)`; `SessionOptions` is passed to `agent.session(sessionId, options?)` and becomes part of `MemoryContext`.

Notable errors: `agent.session(...)` throws when the agent has no memory store configured.

## Example

```ts
import { AgentBuilder, type MemoryStore, type Message } from "@anvia/core";

class InProcessMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load({ sessionId }) {
    return this.sessions.get(sessionId) ?? [];
  }

  async append({ context, messages }) {
    this.sessions.set(context.sessionId, [...(this.sessions.get(context.sessionId) ?? []), ...messages]);
  }

  async clear({ sessionId }) {
    this.sessions.delete(sessionId);
  }
}

const agent = new AgentBuilder("support", model)
  .memory(new InProcessMemoryStore(), { savePolicy: "turn" })
  .build();

const response = await agent
  .session("thread_123", { userId: "user_456" })
  .prompt("Continue from the previous answer.")
  .send();
```

## Related Guides

| Topic | Guide |
| --- | --- |
| Memory overview | [Memory](/docs/advanced/sessions-and-memory) |
| Raw SQL storage | [Raw SQL](/docs/advanced/sessions-and-memory) |
| Prisma storage | [Prisma](/docs/advanced/sessions-and-memory) |
| Drizzle storage | [Drizzle](/docs/advanced/sessions-and-memory) |
| Multi-agent sessions | [Multi-Agent Memory](/docs/advanced/multi-agent-systems) |
