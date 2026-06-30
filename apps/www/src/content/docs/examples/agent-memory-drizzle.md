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
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Message } from "@anvia/core";

export const agentMemoryMessages = pgTable(
  "agent_memory_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id"),
    tenantId: text("tenant_id"),
    runId: text("run_id").notNull(),
    turn: integer("turn").notNull(),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    message: jsonb("message").$type<Message>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agent_memory_session_idx").on(table.sessionId, table.userId, table.tenantId, table.position)],
);

export const schema = { agentMemoryMessages };
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
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type MemoryStore, type Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext } from "@anvia/core/memory";
import { agentMemoryMessages, schema } from "./schema";

type MemoryDb = NodePgDatabase<typeof schema>;

function tenantId(context: MemoryContext) {
  const value = context.metadata?.tenantId;
  return typeof value === "string" ? value : null;
}

function scopedWhere(context: MemoryContext) {
  const tenant = tenantId(context);

  return and(
    eq(agentMemoryMessages.sessionId, context.sessionId),
    context.userId === undefined ? isNull(agentMemoryMessages.userId) : eq(agentMemoryMessages.userId, context.userId),
    tenant === null ? isNull(agentMemoryMessages.tenantId) : eq(agentMemoryMessages.tenantId, tenant),
  );
}

export class DrizzleMemoryStore implements MemoryStore {
  constructor(private readonly db: MemoryDb) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const rows = await this.db
      .select({ message: agentMemoryMessages.message })
      .from(agentMemoryMessages)
      .where(scopedWhere(context))
      .orderBy(asc(agentMemoryMessages.position));

    return rows.map((row) => row.message);
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ position: agentMemoryMessages.position })
        .from(agentMemoryMessages)
        .where(scopedWhere(input.context))
        .orderBy(desc(agentMemoryMessages.position))
        .limit(1);
      const start = (last?.position ?? -1) + 1;

      await tx.insert(agentMemoryMessages).values(
        input.messages.map((message, index) => ({
          sessionId: input.context.sessionId,
          userId: input.context.userId ?? null,
          tenantId: tenantId(input.context),
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
    await this.db.delete(agentMemoryMessages).where(scopedWhere(context));
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

- Use one scope helper for `load`, `append`, and `clear` so tenant filtering cannot drift.
- Store message JSON with the role and original content arrays intact.
- Add stronger per-session locking or a database-generated sequence if concurrent requests can append to the same conversation.
- Keep memory separate from event logs, traces, and audit records.

## Next Patterns

- [Prisma Agent Memory](/docs/examples/agent-memory-prisma)
- [Raw SQL Agent Memory](/docs/examples/agent-memory-raw-sql)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
