---
title: Raw SQL Agent Memory
description: Persist Anvia agent session memory with a raw SQL adapter.
section: examples
sidebar:
  group: Memory and Events
  label: Raw SQL history
  order: 3
---

Use a raw SQL `MemoryStore` when your application has a direct database client, a small storage layer, or a migration system that does not use an ORM.

## Scenario

A Node service talks to Postgres through `pg`. The agent receives a stable session id from the product route, then the memory store loads and appends full Anvia `Message` objects as JSON.

## Table

```sql
CREATE TABLE agent_memory_messages (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  user_id text,
  tenant_id text,
  run_id text NOT NULL,
  turn integer NOT NULL,
  position integer NOT NULL,
  role text NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_memory_session_idx
  ON agent_memory_messages (session_id, user_id, tenant_id, position);
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
import type { Pool } from "pg";
import { type MemoryStore, type Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext } from "@anvia/core/memory";

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

function fromJson(value: unknown): Message {
  return typeof value === "string" ? (JSON.parse(value) as Message) : (value as Message);
}

export class SqlMemoryStore implements MemoryStore {
  constructor(private readonly pool: Pool) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const { rows } = await this.pool.query<{ message: unknown }>(
      `SELECT message
       FROM agent_memory_messages
       WHERE session_id = $1
         AND user_id IS NOT DISTINCT FROM $2
         AND tenant_id IS NOT DISTINCT FROM $3
       ORDER BY position ASC`,
      scopeValues(context),
    );

    return rows.map((row) => fromJson(row.message));
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scopeKey(input.context)]);

      const { rows } = await client.query<{ position: number }>(
        `SELECT COALESCE(MAX(position), -1) AS position
         FROM agent_memory_messages
         WHERE session_id = $1
           AND user_id IS NOT DISTINCT FROM $2
           AND tenant_id IS NOT DISTINCT FROM $3`,
        scopeValues(input.context),
      );
      const start = rows[0]?.position ?? 0;

      for (const [index, message] of input.messages.entries()) {
        await client.query(
          `INSERT INTO agent_memory_messages
             (session_id, user_id, tenant_id, run_id, turn, position, role, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            input.context.sessionId,
            input.context.userId ?? null,
            tenantId(input.context),
            input.runId,
            input.turn,
            start + index + 1,
            message.role,
            JSON.stringify(message),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async clear(context: MemoryContext): Promise<void> {
    await this.pool.query(
      `DELETE FROM agent_memory_messages
       WHERE session_id = $1
         AND user_id IS NOT DISTINCT FROM $2
         AND tenant_id IS NOT DISTINCT FROM $3`,
      scopeValues(context),
    );
  }
}
```

## Use It

```ts
import { Pool } from "pg";
import { AgentBuilder } from "@anvia/core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const memoryStore = new SqlMemoryStore(pool);

const agent = new AgentBuilder("support", model)
  .instructions("Use prior memory before answering.")
  .memory(memoryStore, { savePolicy: "turn" })
  .build();

const response = await agent
  .session("thread_123", {
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  })
  .prompt("Continue from the previous support answer.")
  .send();

console.log(response.output);
```

## Production Checks

- Compare nullable user and tenant columns with null-safe SQL such as `IS NOT DISTINCT FROM`.
- Use a transaction around position lookup and inserts.
- Add per-session locking or database-generated ordering before allowing concurrent writes to the same conversation.
- Keep memory rows scoped by product-owned session, user, and tenant values.

## Next Patterns

- [Prisma Agent Memory](/docs/examples/agent-memory-prisma)
- [Drizzle Agent Memory](/docs/examples/agent-memory-drizzle)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
