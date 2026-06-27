---
title: Runtime State and Persistence
description: What to persist around agent runs, tool calls, events, traces, jobs, and audit records.
section: examples
sidebar:
  group: Foundation Patterns
  order: 6
---

Anvia runs create several kinds of state. Do not collapse them into one table or one transcript. Messages, runtime events, product records, audit logs, traces, and job status each answer different operational questions.

## Scenario

A support answer is wrong. The team needs to find the conversation, replay the agent events, inspect retrieved sources, see which tools ran, connect the external trace, and verify whether any side effects were written.

## Persistence Map

| State | Store it in | Used for |
| --- | --- | --- |
| messages | memory store or conversation table | future prompts and user-visible chat history |
| stream events | event store | replay, debugging, and audit of runtime behavior |
| trace ids | product record or trace backend | cross-system observability |
| tool side effects | product tables | source of truth for business state |
| audit records | audit log | who requested or performed sensitive actions |
| retrieved evidence | evidence log or trace metadata | citation debugging and eval review |
| job status | job table or queue backend | UI status, retries, and worker recovery |

## Example

```ts
import type { AgentEventStore } from "@anvia/core/agent";
import { AgentBuilder } from "@anvia/core";

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
    return db.agentEvents.findMany({ where: { runId } });
  },
  async clear(runId) {
    await db.agentEvents.deleteMany({ where: { runId } });
  },
};

export function createPersistentAgent(scope: PersistentAgentScope) {
  return new AgentBuilder("support", scope.model)
    .instructions("Answer support questions using tools and retrieved policy.")
    .tools(createSupportTools(scope))
    .memory(scope.memoryStore, { savePolicy: "turn" })
    .eventStore(eventStore, { include: "all" })
    .observe(scope.observer)
    .build();
}

export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const agent = createPersistentAgent({ ...input, user });
  const session = agent.session(input.conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  });

  let final;
  for await (const event of session
    .prompt(input.message)
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: { tenantId: user.tenantId },
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
    runId: final.runId,
    traceId: final.trace?.traceId,
    conversationId: input.conversationId,
    userId: user.id,
    tenantId: user.tenantId,
    output: final.output,
  });

  return { output: final.output, runId: final.runId };
}
```

Event store writes are operational data. Product side effects still belong in product tables, and audit records should be written by the tools that perform sensitive actions.

## What Not To Mix

| Do not use | As |
| --- | --- |
| memory | authorization, audit, or current product state |
| event logs | user-facing source of truth |
| traces | durable business records |
| prompt text | permission enforcement |
| model output | unvalidated product writes |

## Production Checks

- Every user-visible answer can be linked to a run id and trace id.
- Side-effect tools write product records and audit records atomically where possible.
- Runtime events have retention and redaction policies.
- Job status is separate from detailed debug events.
- Evidence logs or trace metadata identify which retrieved chunks influenced the answer.

## Next Patterns

- [Agent App Flow](/docs/examples/agent-app-flow)
- [Observability Loop](/docs/examples/observability-loop)
- [Production Readiness](/docs/examples/production-readiness)
