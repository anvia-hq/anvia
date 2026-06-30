---
title: Drizzle Agent Event Store
description: Persist Anvia agent stream events with a Drizzle-backed store.
section: examples
sidebar:
  group: Memory and Events
  label: Drizzle events
  order: 5
---

Use an agent event store when your app needs an ordered runtime log for a streamed agent run. Event records are useful for replay, debugging, audit review, and operations screens that need to inspect turns, deltas, tool calls, tool results, nested agent activity, final output, and errors.

This is not memory. Memory stores `Message[]` for future prompts. The event store stores runtime events by `runId`.

## Scenario

A backoffice support workflow streams through tools. The product stores a compact support-run row for the UI, while the event store keeps the detailed stream history for internal investigation.

## Table

This example uses Drizzle's Postgres core. Store the original event payload as JSONB and index the query fields you need.

```ts
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name"),
    turn: integer("turn"),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    internalCallId: text("internal_call_id"),
    event: jsonb("event").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_events_run_idx").on(table.runId, table.createdAt),
    index("agent_events_agent_idx").on(table.agentId, table.createdAt),
    index("agent_events_tool_idx").on(table.toolName, table.createdAt),
  ],
);

export const schema = { agentEvents };
```

## Expected Event Records

`AgentEventStore.load(runId)` returns `Promise<AgentEventRecord[]>`. Each record includes query fields plus the raw stream event JSON.

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
      "type": "reasoning_delta",
      "turn": 1,
      "delta": "Need live order state.",
      "id": "rs_1",
      "contentType": "text"
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

Other event payloads can include `text_delta`, `tool_call`, `turn_end`, `agent_tool_event`, and `error`. Store the raw `event` JSON so those variants remain available for replay.

## Event Store

```ts
import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AgentEventAppendInput, AgentEventRecord, AgentEventStore } from "@anvia/core/agent";
import { agentEvents, schema } from "./schema";

type EventDb = NodePgDatabase<typeof schema>;

function toJsonSafeEvent(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Error) {
        return { name: nested.name, message: nested.message, stack: nested.stack };
      }
      return nested;
    }),
  );
}

export class DrizzleAgentEventStore implements AgentEventStore {
  constructor(private readonly db: EventDb) {}

  async append(input: AgentEventAppendInput): Promise<void> {
    await this.db.insert(agentEvents).values({
      runId: input.runId,
      agentId: input.agentId,
      agentName: input.agentName ?? null,
      turn: input.turn ?? null,
      toolName: input.toolName ?? null,
      toolCallId: input.toolCallId ?? null,
      internalCallId: input.internalCallId ?? null,
      event: toJsonSafeEvent(input.event),
    });
  }

  async load(runId: string): Promise<AgentEventRecord[]> {
    const rows = await this.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.runId, runId))
      .orderBy(asc(agentEvents.createdAt));

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
    await this.db.delete(agentEvents).where(eq(agentEvents.runId, runId));
  }
}
```

## Use It

```ts
import { AgentBuilder } from "@anvia/core";

const eventStore = new DrizzleAgentEventStore(db);

const agent = new AgentBuilder("support", model)
  .tools(supportTools)
  .eventStore(eventStore, { include: "all" })
  .build();

let finalRunId: string | undefined;

for await (const event of agent.prompt("Where is order A-100?").stream()) {
  if (event.type === "final") {
    finalRunId = event.runId;
  }
}

if (finalRunId === undefined) {
  throw new Error("Agent stream ended without a final event.");
}

const events = await eventStore.load(finalRunId);
```

## Production Checks

- Use `.stream()` and consume the stream when event persistence is required.
- Store raw event JSON, but apply retention and redaction policies before keeping sensitive events long term.
- Use product run records for user-facing status and event records for internal replay.
- Keep event logs separate from memory and traces.

## Next Patterns

- [Prisma Agent Event Store](/docs/examples/agent-event-store-prisma)
- [Raw SQL Agent Event Store](/docs/examples/agent-event-store-raw-sql)
- [Streaming Events](/docs/examples/streaming-events)
