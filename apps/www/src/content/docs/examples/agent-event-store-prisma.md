---
title: Prisma Agent Event Store
description: Persist Anvia agent stream events with Prisma-backed storage.
section: examples
sidebar:
  group: Memory and Events
  label: Prisma events
  order: 4
---

Use an agent event store when your app needs to replay or inspect what happened inside a streamed agent run. Event records answer operational questions: which turn started, which tool was requested, what result came back, whether a nested agent emitted events, what final output was produced, and which run id links to traces.

This is not memory. Memory stores `Message[]` for future prompts. The event store stores runtime events by `runId` for debugging, audit, replay, and internal operations screens.

## Scenario

A support agent streams through tools and retrieval. When an answer looks wrong, the team needs to load the run id and inspect the ordered event log instead of guessing from the final answer.

## Prisma Schema

Store the event payload as JSON and index the fields you need for lookup. The event shape can evolve, so avoid splitting every event field into columns.

```prisma
model AgentEvent {
  id             String   @id @default(cuid())
  runId          String
  agentId        String
  agentName      String?
  turn           Int?
  toolName       String?
  toolCallId     String?
  internalCallId String?
  event          Json
  createdAt      DateTime @default(now())

  @@index([runId, createdAt])
  @@index([agentId, createdAt])
  @@index([toolName, createdAt])
}
```

## Expected Event Records

`AgentEventStore.load(runId)` returns `Promise<AgentEventRecord[]>`. Each record wraps the raw stream event with query fields.

```json
[
  {
    "runId": "run_123",
    "agentId": "support",
    "agentName": "Support",
    "turn": 1,
    "event": {
      "type": "turn_start",
      "turn": 1,
      "prompt": {
        "role": "user",
        "content": [{ "type": "text", "text": "Where is order A-100?" }]
      },
      "history": []
    },
    "createdAt": "2026-06-29T02:40:00.000Z"
  },
  {
    "runId": "run_123",
    "agentId": "support",
    "agentName": "Support",
    "turn": 1,
    "event": {
      "type": "tool_call",
      "turn": 1,
      "toolCall": {
        "type": "tool_call",
        "id": "call_1",
        "callId": "fc_1",
        "function": {
          "name": "lookup_order",
          "arguments": { "orderId": "A-100" }
        }
      }
    },
    "createdAt": "2026-06-29T02:40:01.000Z"
  },
  {
    "runId": "run_123",
    "agentId": "support",
    "agentName": "Support",
    "turn": 1,
    "toolName": "lookup_order",
    "toolCallId": "fc_1",
    "internalCallId": "tool_internal_1",
    "event": {
      "type": "tool_result",
      "turn": 1,
      "toolName": "lookup_order",
      "toolCallId": "fc_1",
      "internalCallId": "tool_internal_1",
      "args": "{\"orderId\":\"A-100\"}",
      "result": "{\"status\":\"shipped\"}"
    },
    "createdAt": "2026-06-29T02:40:02.000Z"
  },
  {
    "runId": "run_123",
    "agentId": "support",
    "agentName": "Support",
    "event": {
      "type": "final",
      "runId": "run_123",
      "output": "Order A-100 has shipped.",
      "usage": {
        "inputTokens": 120,
        "outputTokens": 20,
        "totalTokens": 140,
        "cachedInputTokens": 0,
        "cacheCreationInputTokens": 0
      },
      "messages": []
    },
    "createdAt": "2026-06-29T02:40:03.000Z"
  }
]
```

Other event payloads can include `text_delta`, `reasoning_delta`, `turn_end`, `agent_tool_event`, and `error`. Keep the raw `event` JSON so those variants remain replayable.

## Event Store

```ts
import { Prisma, PrismaClient } from "@prisma/client";
import type { AgentEventAppendInput, AgentEventRecord, AgentEventStore } from "@anvia/core/agent";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Error) {
        return { name: nested.name, message: nested.message, stack: nested.stack };
      }
      return nested;
    }),
  ) as Prisma.InputJsonValue;
}

export class PrismaAgentEventStore implements AgentEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AgentEventAppendInput): Promise<void> {
    await this.prisma.agentEvent.create({
      data: {
        runId: input.runId,
        agentId: input.agentId,
        agentName: input.agentName ?? null,
        turn: input.turn ?? null,
        toolName: input.toolName ?? null,
        toolCallId: input.toolCallId ?? null,
        internalCallId: input.internalCallId ?? null,
        event: toJsonValue(input.event),
      },
    });
  }

  async load(runId: string): Promise<AgentEventRecord[]> {
    const rows = await this.prisma.agentEvent.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      runId: row.runId,
      agentId: row.agentId,
      agentName: row.agentName ?? undefined,
      turn: row.turn ?? undefined,
      toolName: row.toolName ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      internalCallId: row.internalCallId ?? undefined,
      event: row.event,
      createdAt: row.createdAt,
    }));
  }

  async clear(runId: string): Promise<void> {
    await this.prisma.agentEvent.deleteMany({ where: { runId } });
  }
}
```

## Use It

```ts
import { AgentBuilder } from "@anvia/core";

const eventStore = new PrismaAgentEventStore(prisma);

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions using tools and policy context.")
  .tools(supportTools)
  .eventStore(eventStore, { include: "all" })
  .build();

let final;
for await (const event of agent.session("thread_123").prompt("Where is order A-100?").stream()) {
  if (event.type === "final") {
    final = event;
  }
}

if (final === undefined) {
  throw new Error("Agent stream ended without a final event.");
}

const replayEvents = await eventStore.load(final.runId);
```

Use `include: "all"` for full replay. Use `include: "agent_tool_events"` when you only need nested child-agent events from agent tools.

## Production Checks

- Drain `.stream()` when you need event persistence; event records are written as stream events are emitted.
- Apply retention and redaction policies because events can include prompts, history, tool arguments, tool results, reasoning, provider metadata, and errors.
- Keep event logs separate from memory, traces, product records, and audit records.
- Store a smaller product run record for user-facing status; event logs are detailed operational data.

## Next Patterns

- [Drizzle Agent Event Store](/docs/examples/agent-event-store-drizzle)
- [Raw SQL Agent Event Store](/docs/examples/agent-event-store-raw-sql)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
