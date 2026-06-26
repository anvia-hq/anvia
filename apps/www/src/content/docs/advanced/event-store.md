---
title: Event store
description: Persist agent events for replay, debugging, and audit trails.
section: advanced
sidebar:
  group: Agent runtime
  order: 19
---

The event store persists runtime stream events. It is useful for replay, debugging, audit trails, and internal operations views that need to inspect what happened during a run.

Do not confuse event storage with memory. Memory stores messages for future prompts. The event store records runtime events for a run id.

## Event Store Contract

```ts
import type { AgentEventStore } from "@anvia/core/agent";

export const eventStore: AgentEventStore = {
  async append(input) {
    await db.agentEvents.insert({
      runId: input.runId,
      agentId: input.agentId,
      agentName: input.agentName,
      turn: input.turn,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      internalCallId: input.internalCallId,
      event: input.event,
    });
  },
  async load(runId) {
    return db.agentEvents.findMany({ runId });
  },
  async clear(runId) {
    await db.agentEvents.deleteMany({ runId });
  },
};
```

Attach it to the agent:

```ts
const agent = new AgentBuilder("support", model)
  .eventStore(eventStore, { include: "all" })
  .build();
```

`include: "all"` stores every recorded stream event. `include: "agent_tool_events"` stores nested agent tool events only.

## When Events Are Recorded

Event store writes happen while consuming an agent stream. If your workflow needs replayable events, run it through `.stream()` and drain the stream:

```ts
let finalOutput = "";
const session = agent.session(threadId);
const request = session.prompt(message);

for await (const event of request.stream()) {
  if (event.type === "final") {
    finalOutput = event.output;
  }
}
```

The event store records events by `runId`. The final event includes the run id, output, usage, messages, and trace metadata.

## What To Persist

Persist enough fields to query by run id, agent id, turn, tool name, and internal call id. Store the original event payload as structured JSON if your database supports it.

Use retention and redaction policies. Runtime events can include prompt text, history, tool arguments, tool results, reasoning deltas, and provider response data. Those are valuable for debugging, but they may not be safe to keep forever.

## Memory, Events, And Observability

Use each storage path for a different job:

- memory for future prompts
- event store for replay and audit by run id
- observers for traces, metrics, and external telemetry
- product database for business records and user-facing state

Keeping these separate avoids a common production mistake: using debug events as the product source of truth.

## Operational Uses

Event records help answer questions such as:

- Which turn requested a tool?
- What tool result caused the next model call?
- Did a nested agent stream events into the parent run?
- Did the run fail before or after a tool side effect?
- Which run id should be linked to an external trace?

For user-facing status, store a smaller product job record. Event logs are detailed operational data, not usually the UI state model.
