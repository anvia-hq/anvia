---
title: Drizzle Agent Memory
description: Persist Anvia agent session memory with a Drizzle-backed store.
section: examples
sidebar:
  group: Memory and Events
  label: Drizzle history
  order: 2
---

Use a Drizzle-backed `MemoryStore` when your application already uses Drizzle for relational data and you want conversation memory to live beside the rest of your product storage.

## Scenario

A tenant-scoped app stores conversations in Postgres through Drizzle. The route passes a stable conversation id into `agent.session(...)`, and the memory adapter handles loading, appending, and clearing messages for that session.

## Table

This example uses Drizzle's Postgres core. The important part is the same for other relational stores: keep a session scope, an append order, and the full Anvia message JSON.

```ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { JsonObject, Message } from "@anvia/core";

export const agentMemorySessions = pgTable(
  "agent_memory_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKey: text("scope_key").notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id"),
    tenantId: text("tenant_id"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_memory_sessions_scope_key_idx").on(table.scopeKey),
    index("agent_memory_sessions_scope_idx").on(table.sessionId, table.userId, table.tenantId),
  ],
);

export const agentMemoryMessages = pgTable(
  "agent_memory_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memorySessionId: uuid("memory_session_id")
      .notNull()
      .references(() => agentMemorySessions.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    turn: integer("turn").notNull(),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    message: jsonb("message").$type<Message>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_memory_messages_position_idx").on(table.memorySessionId, table.position),
  ],
);

export const schema = { agentMemorySessions, agentMemoryMessages };
```

## Expected Message JSON

`MemoryStore.load(...)` returns `Promise<Message[]>`. This example stores one Anvia `Message` object per row, then returns the ordered row set as an array.

The message union is:

```ts
type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
type UserContent = Text | ImageContent | DocumentContent;
type AssistantContent = Text | ImageContent | Reasoning | ToolCall;
type ToolContent = ToolResult;
```

The full shape returned from `load(...)` is an array. This illustrative array includes every supported message and content variant; real transcripts usually contain only the variants produced by that run.

```json
[
  {
    "role": "system",
    "content": "Stable runtime instructions."
  },
  {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Where is order A-100?",
        "signature": "sig_user_text"
      },
      {
        "type": "image",
        "source": { "type": "url", "url": "https://files.example.com/photo.png" },
        "detail": "high"
      },
      {
        "type": "image",
        "source": {
          "type": "base64",
          "data": "iVBORw0KGgo=",
          "mediaType": "image/png"
        },
        "detail": "low"
      },
      {
        "type": "document",
        "source": {
          "type": "url",
          "url": "https://files.example.com/invoice.pdf",
          "mediaType": "application/pdf",
          "filename": "invoice.pdf"
        }
      },
      {
        "type": "document",
        "source": {
          "type": "base64",
          "data": "JVBERi0xLjQ=",
          "mediaType": "application/pdf",
          "filename": "invoice-copy.pdf"
        }
      },
      {
        "type": "document",
        "source": {
          "type": "text",
          "text": "Invoice text extracted upstream.",
          "mediaType": "text/plain",
          "filename": "invoice.txt"
        }
      }
    ]
  },
  {
    "role": "assistant",
    "id": "msg_assistant_1",
    "content": [
      {
        "type": "text",
        "text": "I will look that up.",
        "signature": "sig_assistant_text"
      },
      {
        "type": "image",
        "source": { "type": "url", "url": "https://files.example.com/generated.png" },
        "detail": "auto"
      },
      {
        "type": "image",
        "source": {
          "type": "base64",
          "data": "iVBORw0KGgo=",
          "mediaType": "image/png"
        }
      },
      {
        "type": "reasoning",
        "id": "rs_1",
        "text": "Checked order status and summarized the result.",
        "content": [
          {
            "type": "text",
            "text": "Need live order state.",
            "signature": "sig_reasoning_text"
          },
          {
            "type": "summary",
            "text": "Order lookup is required."
          },
          {
            "type": "encrypted",
            "data": "encrypted_reasoning_blob"
          },
          {
            "type": "redacted",
            "data": "redacted_reasoning_blob"
          }
        ]
      },
      {
        "type": "tool_call",
        "id": "call_1",
        "callId": "fc_1",
        "function": {
          "name": "lookup_order",
          "arguments": { "orderId": "A-100" }
        },
        "signature": "sig_tool_call",
        "additionalParams": { "providerToolCallId": "provider_call_1" }
      }
    ]
  },
  {
    "role": "tool",
    "content": [
      {
        "type": "tool_result",
        "id": "call_1",
        "callId": "fc_1",
        "content": [
          {
            "type": "text",
            "text": "{\"status\":\"shipped\"}"
          },
          {
            "type": "image",
            "data": "iVBORw0KGgo=",
            "mediaType": "image/png"
          }
        ]
      }
    ]
  },
  {
    "role": "assistant",
    "content": [{ "type": "text", "text": "Order A-100 has shipped." }]
  }
]
```

Each row's `message` column contains one item from that array.

## Memory Store

```ts
import { asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type JsonObject, type MemoryStore, type Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext } from "@anvia/core/memory";
import { agentMemoryMessages, agentMemorySessions, schema } from "./schema";

type MemoryDb = NodePgDatabase<typeof schema>;

function tenantId(context: MemoryContext) {
  const value = context.metadata?.tenantId;
  return typeof value === "string" ? value : null;
}

function scopeValues(context: MemoryContext) {
  return [context.sessionId, context.userId ?? null, tenantId(context)] as const;
}

function scopeKey(context: MemoryContext) {
  return JSON.stringify(scopeValues(context));
}

function metadata(context: MemoryContext): JsonObject {
  return context.metadata ?? {};
}

export class DrizzleMemoryStore implements MemoryStore {
  constructor(private readonly db: MemoryDb) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const rows = await this.db
      .select({ message: agentMemoryMessages.message })
      .from(agentMemoryMessages)
      .innerJoin(
        agentMemorySessions,
        eq(agentMemoryMessages.memorySessionId, agentMemorySessions.id),
      )
      .where(eq(agentMemorySessions.scopeKey, scopeKey(context)))
      .orderBy(asc(agentMemoryMessages.position));

    return rows.map((row) => row.message);
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      const key = scopeKey(input.context);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

      const [memorySession] = await tx
        .insert(agentMemorySessions)
        .values({
          scopeKey: key,
          sessionId: input.context.sessionId,
          userId: input.context.userId ?? null,
          tenantId: tenantId(input.context),
          metadata: metadata(input.context),
        })
        .onConflictDoUpdate({
          target: agentMemorySessions.scopeKey,
          set: {
            metadata: metadata(input.context),
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: agentMemorySessions.id });
      if (memorySession === undefined) {
        throw new Error("Failed to resolve memory session.");
      }

      const [last] = await tx
        .select({ position: agentMemoryMessages.position })
        .from(agentMemoryMessages)
        .where(eq(agentMemoryMessages.memorySessionId, memorySession.id))
        .orderBy(desc(agentMemoryMessages.position))
        .limit(1);
      const start = (last?.position ?? -1) + 1;

      await tx.insert(agentMemoryMessages).values(
        input.messages.map((message, index) => ({
          memorySessionId: memorySession.id,
          runId: input.runId,
          turn: input.turn,
          position: start + index,
          role: message.role,
          message,
        })),
      );
    });
  }

  async clear(context: MemoryContext): Promise<void> {
    await this.db
      .delete(agentMemorySessions)
      .where(eq(agentMemorySessions.scopeKey, scopeKey(context)));
  }
}
```

## Use It

```ts
import { AgentBuilder } from "@anvia/core";

const memoryStore = new DrizzleMemoryStore(db);

const agent = new AgentBuilder("support", model)
  .instructions("Use durable memory to continue the conversation.")
  .memory(memoryStore, { savePolicy: "turn" })
  .build();

await agent
  .session("thread_123", {
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  })
  .prompt("What did we decide last time?")
  .send();
```

## Production Checks

- Use `scopeKey` for one canonical nullable user and tenant scope lookup.
- Keep session ownership and lifecycle metadata on `agentMemorySessions`.
- Keep full Anvia message JSON intact on `agentMemoryMessages`.
- Use transactions and advisory locks before allowing concurrent writes to the same conversation.
- Keep memory separate from event logs, traces, and audit records.

## Next Patterns

- [Prisma Agent Memory](/docs/examples/agent-memory-prisma)
- [Raw SQL Agent Memory](/docs/examples/agent-memory-raw-sql)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
