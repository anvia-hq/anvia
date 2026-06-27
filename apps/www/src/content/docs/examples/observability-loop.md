---
title: Observability Loop
description: A pattern for connecting traces, runtime events, logs, evidence, and evals.
section: examples
sidebar:
  group: Quality and Operations
  order: 2
---

Observability should connect one product request across traces, runtime events, logs, retrieved evidence, tool calls, final answers, and eval outcomes. Each store has a different job.

## Scenario

A support answer is wrong. The team needs to see the user, tenant, selected documents, tool calls, final answer, trace id, run events, and whether a regression eval caught it.

## Flow

| Signal | Store |
| --- | --- |
| trace metadata | observer backend |
| stream events | event store |
| selected evidence | evidence log |
| permission decisions | app log/audit log |
| final answer | conversation or job record |
| eval result | eval reporter |

## Example

```ts
const response = await agent
  .prompt([...history, Message.user(input.message)])
  .withTrace({
    name: "support-chat",
    userId: user.id,
    metadata: {
      tenantId: user.tenantId,
      conversationId: input.conversationId,
      channel: input.channel,
      release: input.release,
      promptVersion: input.promptVersion,
    },
  })
  .send();

await input.runRecords.record({
  conversationId: input.conversationId,
  traceId: response.trace?.traceId,
  output: response.output,
  usage: response.usage,
  release: input.release,
  promptVersion: input.promptVersion,
});
```

Log app-owned decisions separately:

```ts
logger.info({
  event: "support_tool_allowed",
  userId: user.id,
  tenantId: user.tenantId,
  tool: "lookup_order",
  orderId: input.orderId,
  traceId: response.trace?.traceId,
});
```

Record selected evidence when retrieval is part of the answer:

```ts
await evidenceLog.record({
  conversationId: input.conversationId,
  traceId: response.trace?.traceId,
  sourceIds: selectedEvidence.map((item) => item.id),
  scores: selectedEvidence.map((item) => item.score),
});
```

Send eval outcomes back to the same product ids:

```ts
const evalReporter = {
  async report(args) {
    await evalResults.insert({
      suite: args.suiteName,
      caseId: args.case.id,
      metric: args.metric.name,
      status: args.outcome.status,
      conversationId: args.case.metadata?.conversationId,
      release: args.case.metadata?.release,
    });
  },
};
```

## Failure Modes

- Trace metadata omits tenant, conversation id, or release.
- Tool permission decisions are not logged.
- Eval failures cannot be linked back to prompts or traces.
- Runtime events are stored without product ids.
- Full documents or private tool results are stored in trace metadata.

## Next Patterns

- [Streaming Events](/docs/examples/streaming-events)
- [Eval Loop](/docs/examples/eval-loop)
- [Production Readiness](/docs/examples/production-readiness)
