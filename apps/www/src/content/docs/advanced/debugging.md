---
title: Debugging
description: Diagnose failed runs, tool errors, streaming issues, and bad context.
section: advanced
sidebar:
  group: Quality and operations
  order: 54
---

Debugging an agent run is mostly about finding the boundary that failed: input, model capability, memory, retrieval, tool selection, tool execution, approvals, streaming, observers, or product mapping.

Start from the product event and follow ids into traces, event stores, logs, and eval cases.

## Start With The Run

Every production runner should attach a stable trace name and safe metadata:

```ts
const request = session
  .prompt(message)
  .withTrace({
    name: "support-chat",
    userId: user.id,
    sessionId: conversationId,
    metadata: {
      tenantId: user.tenantId,
      conversationId,
      ticketId,
    },
  });

const response = await request.send();
```

Log the returned `traceId` next to the product event. That gives support and engineering a path from product state to runtime evidence.

## Check The Failure Class

Common classes:

- capability error: model does not support tools, streaming, schemas, image input, or document input
- max turns: the agent loop kept calling tools
- tool error: schema, permission, service, or side-effect failure
- approval error: missing handler, rejected request, or timed-out app workflow
- retrieval error: wrong index, weak threshold, bad chunking, missing filter
- stream error: provider stream failed or UI received an unhandled event
- observer error: telemetry failed, usually swallowed unless strict mode is enabled

Map known errors at the runner boundary. Do not expose raw provider or stack details to users.

## Inspect Tools

For a tool failure, inspect:

- tool name
- parsed arguments
- internal call id
- skipped flag
- structured result
- permission state used by the handler
- product service error

Then reproduce with a direct tool call using fake services. If the direct call fails, fix the tool or service. If the direct call passes, inspect why the model chose that tool or those arguments.

## Inspect Retrieval

For bad context, check the retrieval inputs:

- query text used for search
- selected index
- `topK` and `threshold`
- metadata filter
- result ids and scores
- formatted document text

If the right document is not selected, tune chunking, metadata, filters, or thresholds. If the right document is selected but ignored, improve formatting or instructions.

## Inspect Streams

When a streaming UI behaves incorrectly, first collect the raw server-side agent stream:

```ts
const request = agent.prompt("Stream a short answer.");
const eventTypes = [];

for await (const event of request.stream()) {
  eventTypes.push(event.type);
}

runtimeLog.info({ eventTypes });
```

Then inspect the transport filter that maps runtime events to browser-safe events. Many stream bugs are filtering bugs, not model bugs.

## Use Event Store For Replay

If you need run replay or audit-style runtime inspection, configure an event store and consume `.stream()`:

```ts
const agent = new AgentBuilder("support", model)
  .eventStore(eventStore, { include: "all" })
  .build();
```

Event storage is driven by streaming. If you need event records for a run, run the workflow with `.stream()` and consume the events.

## Turn Failures Into Tests

After debugging, add the smallest repeatable check:

- unit test for permission or service failure
- retrieval test for missing or leaked context
- stream test for browser event shape
- eval case for answer quality or tool choice
- provider smoke test for capability drift

The best debugging outcome is a narrower failure that cannot silently come back.
