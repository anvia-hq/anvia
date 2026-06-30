---
title: Raw SQL Agent Event Store
description: Persist Anvia agent stream events with a raw SQL adapter.
section: examples
sidebar:
  group: Memory and Events
  label: Raw SQL events
  order: 6
---

Use a raw SQL event store when your application talks directly to the database and needs replayable runtime events for streamed agent runs.

Event storage is for operational visibility: debugging bad answers, replaying tool behavior, inspecting nested agent activity, and linking a product run to trace metadata. It is not memory and should not be used as the conversation transcript for future prompts.

## Scenario

A Node service uses Postgres through `pg`. The support agent streams to an internal operations surface, and every stream event is persisted under the same run id.

## Table

```sql
CREATE TABLE agent_events (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  agent_id text NOT NULL,
  agent_name text,
  turn integer,
  tool_name text,
  tool_call_id text,
  internal_call_id text,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_events_run_idx
  ON agent_events (run_id, created_at);

CREATE INDEX agent_events_agent_idx
  ON agent_events (agent_id, created_at);

CREATE INDEX agent_events_tool_idx
  ON agent_events (tool_name, created_at);
```

## Expected Event Records

`AgentEventStore.load(runId)` returns `Promise<AgentEventRecord[]>`. Each record contains indexed fields and the original stream event payload.

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
      "type": "text_delta",
      "turn": 1,
      "delta": "Checking"
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

Other event payloads can include `reasoning_delta`, `tool_call`, `turn_end`, `agent_tool_event`, and `error`. Store `event` as JSONB so those variants can be preserved without adding columns.

## Event Store

```ts
import type { Pool } from "pg";
import type { AgentEventAppendInput, AgentEventRecord, AgentEventStore } from "@anvia/core/agent";

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

function fromJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export class SqlAgentEventStore implements AgentEventStore {
  constructor(private readonly pool: Pool) {}

  async append(input: AgentEventAppendInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_events
         (run_id, agent_id, agent_name, turn, tool_name, tool_call_id, internal_call_id, event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        input.runId,
        input.agentId,
        input.agentName ?? null,
        input.turn ?? null,
        input.toolName ?? null,
        input.toolCallId ?? null,
        input.internalCallId ?? null,
        JSON.stringify(toJsonSafeEvent(input.event)),
      ],
    );
  }

  async load(runId: string): Promise<AgentEventRecord[]> {
    const { rows } = await this.pool.query<{
      run_id: string;
      agent_id: string;
      agent_name: string | null;
      turn: number | null;
      tool_name: string | null;
      tool_call_id: string | null;
      internal_call_id: string | null;
      event: unknown;
      created_at: Date;
    }>(
      `SELECT run_id, agent_id, agent_name, turn, tool_name, tool_call_id,
              internal_call_id, event, created_at
       FROM agent_events
       WHERE run_id = $1
       ORDER BY created_at ASC, id ASC`,
      [runId],
    );

    return rows.map((row) => ({
      runId: row.run_id,
      agentId: row.agent_id,
      agentName: row.agent_name ?? undefined,
      turn: row.turn ?? undefined,
      toolName: row.tool_name ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      internalCallId: row.internal_call_id ?? undefined,
      event: fromJson(row.event),
      createdAt: row.created_at,
    }));
  }

  async clear(runId: string): Promise<void> {
    await this.pool.query("DELETE FROM agent_events WHERE run_id = $1", [runId]);
  }
}
```

## Use It

```ts
import { Pool } from "pg";
import { AgentBuilder } from "@anvia/core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const eventStore = new SqlAgentEventStore(pool);

const agent = new AgentBuilder("support", model)
  .tools(supportTools)
  .eventStore(eventStore, { include: "all" })
  .build();

let final;
for await (const event of agent.prompt("Where is order A-100?").stream()) {
  if (event.type === "final") {
    final = event;
  }
}

if (final === undefined) {
  throw new Error("Agent stream ended without a final event.");
}

const eventLog = await eventStore.load(final.runId);
```

## Production Checks

- Drain the stream to persist events.
- Keep raw event logs internal unless product policy explicitly allows exposing them.
- Redact or expire events that include private prompts, history, tool arguments, tool results, reasoning, provider payloads, or errors.
- Use product tables for user-visible state and event logs for operational replay.

## Next Patterns

- [Prisma Agent Event Store](/docs/examples/agent-event-store-prisma)
- [Drizzle Agent Event Store](/docs/examples/agent-event-store-drizzle)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
