---
title: Streaming events
description: Consume agent stream events and nested generation updates.
section: advanced
sidebar:
  group: Agent runtime
  order: 15
  label: Events
---

Agent streams expose the runtime as it works. They are higher level than direct completion streams because they include turns, tool calls, tool results, nested agent events, final output, usage, and errors.

Use streaming when a UI needs progressive text, when an operations surface needs tool visibility, or when a worker needs to persist progress while the run is active.

## Consume A Stream

```ts
const session = agent.session(threadId);
const request = session.prompt(message);

for await (const event of request.stream()) {
  switch (event.type) {
    case "text_delta":
      await ui.writeText(event.delta);
      break;
    case "tool_call":
      await ui.showToolPending(event.toolCall.function.name);
      break;
    case "final":
      await ui.finish(event.output, event.usage);
      break;
    case "error":
      await ui.fail(event.error, event.usage);
      break;
  }
}
```

The stream throws after yielding an `"error"` event. Wrap the loop at the runner boundary so your app can map failures into product responses.

## Event Types

Agent streams can emit:

- `"turn_start"` with the current prompt and history for the turn
- `"text_delta"` for incremental assistant text
- `"reasoning_delta"` when the provider emits reasoning content
- `"tool_call"` when the model asks for a tool
- `"tool_result"` after a tool returns or is skipped
- `"turn_end"` with the provider response for a turn
- `"agent_tool_event"` for events from a nested agent used as a tool
- `"final"` with output, usage, messages, run id, and trace metadata
- `"error"` with cumulative authoritative usage when the run fails

Do not send every event directly to a browser. Tool arguments, tool results, reasoning content, and provider metadata can contain private data. Filter the stream for each surface.

## Client-Safe Projection

Create a projection layer between Anvia events and your UI protocol:

```ts
function toClientEvent(event: AgentStreamEvent) {
  if (event.type === "text_delta") {
    return { type: "text", delta: event.delta };
  }
  if (event.type === "final") {
    return { type: "done", output: event.output, usage: event.usage };
  }
  if (event.type === "error") {
    return {
      type: "error",
      message: "The assistant could not complete the request.",
      usage: event.usage,
    };
  }
  if (event.type === "tool_call") {
    return { type: "status", label: "Checking data" };
  }
}
```

Internal tools can receive richer events. User-facing streams should usually expose text, status, final output, and safe error messages only.

## Error Usage Compatibility

`AgentStreamEvent` error records require `usage`. Code that constructs agent events in tests, mocks,
or custom runtimes must now include it. Use the cumulative authoritative usage received by the run,
or `Usage.empty()` when no provider has reported usage yet.

Provider-level `CompletionStreamEvent` errors keep usage optional. Network interruptions, provider
failures without usage, and Chat Completions streams that end before their usage chunk cannot be
accounted exactly. Anvia does not estimate those tokens from text or request contents.

## Nested Agent Events

An agent can be exposed as a tool with `agent.asTool(...)`. When that tool streams, the parent stream can emit `"agent_tool_event"` with the child agent id, tool name, internal call id, and child event.

Use nested events for debugging and internal operations. For product UIs, collapse them into a simple status unless the user is meant to inspect the sub-agent workflow.

## Persistence

Configure `.eventStore(...)` when you need to persist runtime events:

```ts
const agent = new AgentBuilder("research", model)
  .eventStore(eventStore, { include: "all" })
  .build();
```

Event storage is driven by streaming. If you need event replay or audit records, run the workflow with `.stream()` and consume the events, even when the final product response only uses the final output.

## Readable Streams

Use `.readableStream()` or server helpers when the transport needs a web `ReadableStream`:

```ts
const session = agent.session(threadId);
const request = session.prompt(message);

return new Response(request.readableStream());
```

For production routes, prefer a server adapter that also sets headers, serialization, cancellation behavior, and error mapping for your framework.
