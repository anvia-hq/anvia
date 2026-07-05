---
title: Prisma Agent Memory
description: Persist Anvia agent session memory with Prisma-backed storage.
section: examples
sidebar:
  group: Memory and Events
  label: Prisma history
  order: 1
---

Use a Prisma-backed `MemoryStore` when your product already owns conversation data through Prisma and you want agent sessions to load the same durable transcript on every turn.

## Scenario

A support chat route uses Prisma for product data. Each request receives a product-owned `conversationId`, authenticated `userId`, and tenant metadata. The agent should load prior messages before the run and append the new runtime messages after each completed turn.

## Prisma Schema

Store full Anvia `Message` objects as JSON. Do not persist only final assistant text; tool-call and tool-result messages are part of the conversation context.

```prisma
model AgentMemorySession {
  id        String   @id @default(cuid())
  scopeKey  String   @unique
  sessionId String
  userId    String?
  tenantId  String?
  metadata  Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages AgentMemoryMessage[]

  @@index([sessionId, userId, tenantId])
}

model AgentMemoryMessage {
  id              String             @id @default(cuid())
  memorySessionId String
  memorySession   AgentMemorySession @relation(fields: [memorySessionId], references: [id], onDelete: Cascade)
  runId           String
  turn            Int
  position        Int
  role            String
  message         Json
  createdAt       DateTime           @default(now())

  @@unique([memorySessionId, position])
}
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
import { Prisma, PrismaClient } from "@prisma/client";
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

function toPrismaJson(message: Message): Prisma.InputJsonValue {
  return message as unknown as Prisma.InputJsonValue;
}

function metadataJson(context: MemoryContext): Prisma.InputJsonValue {
  return (context.metadata ?? {}) as Prisma.InputJsonValue;
}

export class PrismaMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const rows = await this.prisma.agentMemoryMessage.findMany({
      where: { memorySession: { scopeKey: scopeKey(context) } },
      orderBy: { position: "asc" },
    });

    return rows.map((row) => row.message as unknown as Message);
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    await this.prisma.$transaction(
      async (tx) => {
        const memorySession = await tx.agentMemorySession.upsert({
          where: { scopeKey: scopeKey(input.context) },
          update: { metadata: metadataJson(input.context) },
          create: {
            scopeKey: scopeKey(input.context),
            sessionId: input.context.sessionId,
            userId: input.context.userId ?? null,
            tenantId: tenantId(input.context),
            metadata: metadataJson(input.context),
          },
        });

        const last = await tx.agentMemoryMessage.findFirst({
          where: { memorySessionId: memorySession.id },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        const start = (last?.position ?? -1) + 1;

        await tx.agentMemoryMessage.createMany({
          data: input.messages.map((message, index) => ({
            memorySessionId: memorySession.id,
            runId: input.runId,
            turn: input.turn,
            position: start + index,
            role: message.role,
            message: toPrismaJson(message),
          })),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async clear(context: MemoryContext): Promise<void> {
    await this.prisma.agentMemorySession.deleteMany({
      where: {
        scopeKey: scopeKey(context),
      },
    });
  }
}
```

## Use It

```ts
import { AgentBuilder } from "@anvia/core";

const prisma = new PrismaClient();
const memoryStore = new PrismaMemoryStore(prisma);

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions using the durable conversation history.")
  .memory(memoryStore, { savePolicy: "turn" })
  .build();

const response = await agent
  .session("thread_123", {
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  })
  .prompt("Can you summarize where we left off?")
  .send();

console.log(response.output);
```

## Production Checks

- Use `scopeKey` for one canonical nullable user and tenant scope lookup.
- Keep session ownership and lifecycle metadata on `AgentMemorySession`.
- Keep full Anvia message JSON intact on `AgentMemoryMessage`.
- Use serializable transactions or retry failed writes if multiple requests can append concurrently.
- Keep audit records, run records, and product state in separate tables from memory.

## Next Patterns

- [Drizzle Agent Memory](/docs/examples/agent-memory-drizzle)
- [Raw SQL Agent Memory](/docs/examples/agent-memory-raw-sql)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
