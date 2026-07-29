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
  readonly compaction?: MemoryCompactionStore;
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

## MemoryCompactionStore

```ts
type MemoryCompactionSnapshot = {
  revision: string;
  messages: Message[];
};

type MemoryCompactionCommitInput = {
  context: MemoryContext;
  revision: string;
  compactedMessageCount: number;
  summary: SystemMessage;
  runId: string;
};

type MemoryCompactionCommitResult = "committed" | "conflict";

interface MemoryCompactionStore {
  load(context: MemoryContext): Promise<MemoryCompactionSnapshot>;
  commit(input: MemoryCompactionCommitInput): Promise<MemoryCompactionCommitResult>;
}
```

Purpose: optional durable prefix replacement used by automatic agent memory compaction. The
official Prisma, Drizzle, Postgres, and SQLite stores implement this capability.

Return behavior: `load(...)` returns ordered messages and an opaque revision. `commit(...)`
atomically replaces `compactedMessageCount` messages with one summary only when the revision still
matches. A concurrent memory update returns `"conflict"` without changing the transcript.

Notable errors: stores reject invalid summary messages and invalid compacted counts. Applications
implementing custom stores must perform the revision check and prefix replacement in one
transaction.

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
  compaction?: MemoryCompactionOptions | undefined;
};

type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
  compaction?: ResolvedMemoryCompactionOptions | undefined;
};

function resolveMemoryOptions(options?: MemoryOptions): ResolvedMemoryOptions;
```

Purpose: configures when `AgentSession` appends messages to the configured store.

Return behavior: `resolveMemoryOptions(...)` fills the default `savePolicy: "message"`. `AgentBuilder.memory(store, options?)` stores the resolved policy in `MemoryRegistration`.

Notable errors: invalid compaction limits throw `RangeError`, and a missing compactor function
throws `TypeError`.

| Policy | Behavior |
| --- | --- |
| `"message"` | Save completed user, assistant, and tool-result messages as they become available. |
| `"turn"` | Save completed messages after each model/tool loop turn. |
| `"run"` | Save only after a successful final response. |

## Automatic Compaction

```ts
type MemoryCompactorInput = {
  context: MemoryContext;
  messages: Message[];
};

type MemoryCompactorResult = {
  summary: string;
  usage?: Usage;
};

type MemoryCompactor = (
  input: MemoryCompactorInput,
) => Promise<MemoryCompactorResult>;

type MemoryCompactionOptions = {
  maxMessages: number;
  keepRecentUserTurns?: number;
  compactor: MemoryCompactor;
  conflictRetries?: number;
};

type SummaryMemoryCompactorOptions = {
  instructions?: string;
  maxTokens?: number;
  temperature?: number;
};

function createSummaryMemoryCompactor(
  model: CompletionModel,
  options?: SummaryMemoryCompactorOptions,
): MemoryCompactor;

function isMemoryCompactionSummary(message: Message): boolean;
```

Purpose: summarize older user-led turns when stored history plus the incoming prompt exceeds
`maxMessages`. The default retained tail is four user-led turns, conflict commits are retried once,
and the built-in summary model is limited to 1,024 output tokens.

Return behavior: the summary is stored as a tagged system message, retained rows preserve their
original storage metadata, and summary-model usage is included in the agent run total.
`isMemoryCompactionSummary(...)` detects the framework metadata tag.

Notable errors: `MemoryCompactionError` reports compactor failures or empty summaries.
`MemoryCompactionConflictError` reports exhausted concurrent-update retries. Configuring compaction
with a custom store that lacks `MemoryCompactionStore` throws during agent construction.

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
