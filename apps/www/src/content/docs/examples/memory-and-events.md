---
title: Memory and Events
description: How agent memory and event stores differ, how each maps to database storage, and how they are used together in production.
section: examples
sidebar:
  group: Memory and Events
  label: Overview
  order: 0
---

Production agents often use both memory and event storage, but they solve different problems. Memory is conversation context for future prompts. Event storage is an operational log of what happened during one streamed run.

Do not merge them into one transcript table. A memory store answers "what should the model remember next time?" An event store answers "what happened during run `run_123`?"

## What Each Store Does

| Store | Key | Contract | Contains | Used for |
| --- | --- | --- | --- | --- |
| memory | `sessionId`, plus user or tenant scope | `MemoryStore.load(context): Promise<Message[]>` | ordered Anvia `Message[]` values | future prompts, durable conversations, `session.messages()` |
| event store | `runId` | `AgentEventStore.load(runId): Promise<AgentEventRecord[]>` | ordered stream events with raw `event` JSON | replay, debugging, audit review, operations views |

Memory is loaded before the next run and becomes model context. Event records are not loaded into prompts; they are inspected by humans, eval tooling, dashboards, or replay/debug flows.

## Production Layout

Keep these as separate storage paths:

| Data | Typical table | Why it exists |
| --- | --- | --- |
| conversation memory | `agent_memory_messages` | gives the next prompt prior user, assistant, and tool-result messages |
| runtime events | `agent_events` | preserves turn starts, deltas, tool calls, tool results, nested agent events, final output, and errors by run id |
| product run record | `support_runs` or `agent_runs` | compact user-facing status, final output, trace id, and usage |
| audit records | `audit_logs` | records who requested or performed sensitive product actions |
| traces | tracing backend or trace id fields | connects the run to model/provider/tool observability |

Memory rows are scoped by product-owned session, user, and tenant values. Event rows are scoped by run id and agent metadata. Product run records usually connect both worlds by storing `conversationId`, `runId`, `traceId`, final output, and usage.

## Typical Flow

```ts
import { AgentBuilder } from "@anvia/core";

export function createSupportAgent(scope: SupportAgentScope) {
  return new AgentBuilder("support", scope.model)
    .instructions("Answer support questions using tools and policy context.")
    .tools(scope.tools)
    .memory(scope.memoryStore, { savePolicy: "turn" })
    .eventStore(scope.eventStore, { include: "all" })
    .build();
}

export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportAgent({
    model: input.model,
    tools: input.tools,
    memoryStore: input.memoryStore,
    eventStore: input.eventStore,
  });

  let final;

  for await (const event of agent
    .session(input.conversationId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .prompt(input.message)
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .stream()) {
    if (event.type === "final") {
      final = event;
    }
  }

  if (final === undefined) {
    throw new Error("Agent stream ended without a final event.");
  }

  await input.runs.record({
    conversationId: input.conversationId,
    runId: final.runId,
    traceId: final.trace?.traceId,
    output: final.output,
    usage: final.usage,
  });

  return { output: final.output, runId: final.runId };
}
```

The event store records events while the stream is consumed. If you need replayable events, use `.stream()` and drain it even when your API only returns the final answer. Use `.send()` when the caller only needs the final response and event replay is not required.

## Choosing The Adapter

Use the adapter style that matches your product database layer:

| Need | Prisma | Drizzle | Raw SQL |
| --- | --- | --- | --- |
| memory | [Prisma Agent Memory](/docs/examples/agent-memory-prisma) | [Drizzle Agent Memory](/docs/examples/agent-memory-drizzle) | [Raw SQL Agent Memory](/docs/examples/agent-memory-raw-sql) |
| events | [Prisma Agent Event Store](/docs/examples/agent-event-store-prisma) | [Drizzle Agent Event Store](/docs/examples/agent-event-store-drizzle) | [Raw SQL Agent Event Store](/docs/examples/agent-event-store-raw-sql) |

The adapter choice should not change the runtime contract. Memory still returns `Message[]`; event storage still returns `AgentEventRecord[]`.

## Production Checks

- Keep memory, events, audit logs, traces, and product state in separate tables or services.
- Apply tenant and user scope to memory reads and writes.
- Store event payloads as JSON/JSONB and index `runId`, `agentId`, `turn`, and tool identifiers.
- Set retention and redaction policies for both memory and events; event payloads may include prompts, history, tool args, tool results, reasoning, provider metadata, and errors.
- Store a compact product run record for UI status instead of querying event logs for normal user-facing pages.
