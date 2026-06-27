---
title: Readable streams
description: Convert async runtime events into web-readable streams for clients.
section: advanced
sidebar:
  group: Agent runtime
  order: 16
---

Readable streams are the bridge between Anvia async runtime events and web transports. Use them when a server route needs to return streaming bytes to a browser, edge runtime, worker client, or framework response.

`PromptRequest.readableStream()` converts an agent stream into a `ReadableStream<Uint8Array>`. Each event is serialized as one JSON line.

## Return A Stream

Create the session and request first, then return the readable stream:

```ts
const session = agent.session(threadId, {
  userId: user.id,
  metadata: { tenantId: user.tenantId },
});
const request = session.prompt(input.message).withTrace({
  name: "support-chat",
  userId: user.id,
  metadata: { tenantId: user.tenantId, threadId },
});

return new Response(request.readableStream(), {
  headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  },
});
```

The response body contains newline-delimited JSON. A client can read chunks, split on newlines, parse each line, and render safe events.

## Direct Conversion

Use `toReadableStream(...)` when you already have an async iterable of events:

```ts
import { toReadableStream } from "@anvia/core/streaming";

const events = request.stream();

return new Response(toReadableStream(events), {
  headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
  },
});
```

`request.readableStream()` is the convenience form for agent prompt requests. `toReadableStream(...)` is the lower-level utility.

## Event Shape

The stream writes one JSON object per line:

```json
{"type":"text_delta","turn":1,"delta":"Hello"}
{"type":"final","runId":"run_123","output":"Hello","usage":{"inputTokens":12,"outputTokens":4,"totalTokens":16,"cachedInputTokens":0,"cacheCreationInputTokens":0},"messages":[]}
```

The final event always includes the run id, final output, usage, and runtime messages. It may also include trace metadata when the request was traced.

If a generic async iterable throws, `toReadableStream(...)` serializes the thrown error as an error event line and closes:

```json
{"type":"error","error":{"name":"Error","message":"Provider request failed"}}
```

`PromptRequest.stream()` also yields a runtime `error` event before rethrowing the failure. If you expose `request.readableStream()` directly, raw runtime error details can reach the client. Project or catch stream events before exposing them to users if errors may contain provider details, tool arguments, or internal service names.

## Client Projection

Do not treat the runtime stream as your public UI protocol. Project Anvia events into product-safe client events:

```ts
async function* clientEvents(request) {
  for await (const event of request.stream()) {
    if (event.type === "text_delta") {
      yield { type: "text", delta: event.delta };
    }
    if (event.type === "tool_call") {
      yield { type: "status", label: "Checking data" };
    }
    if (event.type === "final") {
      yield { type: "done", output: event.output, usage: event.usage };
    }
  }
}

return new Response(toReadableStream(clientEvents(request)));
```

This keeps private runtime data out of the browser while preserving a streaming user experience.

## Cancellation

When the client disconnects, the readable stream calls `return()` on the underlying async iterator. Use your framework's request abort signal as the outer cancellation boundary, and avoid starting unrelated background work inside the stream loop unless it has its own cleanup path.

Memory writes, event store writes, hooks, observers, and tool calls still follow the normal agent runtime lifecycle while the stream is consumed.

## When To Use Server Helpers

Use package or framework helpers when they are available in your app stack. A helper can standardize headers, JSONL parsing, abort handling, and client event projection.

Use `readableStream()` directly when you need a small server route, a custom transport, or a worker endpoint that already understands newline-delimited JSON.
