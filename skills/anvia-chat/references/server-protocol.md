# Server Protocol

Server routes adapt native runtime events at the boundary, then frame them.
`@anvia/core` owns native completion and Agent events; `@anvia/client` owns the
wire adapters; `@anvia/server` owns the HTTP framing.

## Completion route

```ts
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";

const body = parseClientStreamRequest(await request.json());
if (body.type !== "messages") throw new Error("This completion endpoint accepts messages only.");
const events = completionToClientStream({
  events: streamCompletion({ model, messages: body.messages }),
});
return createClientStreamResponse({ events }); // JSONL by default
```

## Agent route

Use `agentToClientStream` instead of `completionToClientStream` for Agent events
(it preserves nested-agent scope). Accept both request shapes: `messages` starts
a run, `interaction_response` resumes one. Validate with `parseClientStreamRequest`.

For application-defined stream data, `customAgentEventsToClientStream` wraps an
agent event stream and `mapCustomEvent` maps app events into `data` events; the
client validates them against `dataSchemas` (see
`references/transports-state.md`) and they surface as data parts.

## Framing rules

- `createClientStreamResponse({ events })` always emits `stream_start`, ordered
  `stream_event` frames, then `stream_end`, with header
  `x-anvia-stream-protocol: anvia.client.v3`. This is the client protocol claim.
- Pass `format: "sse"` for SSE framing; JSONL is the default.
- For resumable streams, pass `{ resumable: { streamId, store } }` when creating
  the response and call `resumeClientStreamResponse({ streamId, after, store })`
  for resume requests. The client side pairs this with
  `useChat({ transport, resume: { key } })`.
- `createEventStreamResponse` / `resumeEventStreamResponse` (and the lower-level
  `createJsonlStream`, `createSseStream`, `createResumableStream`,
  `resumeStreamEvents`, `createMemoryResumableStreamStore`) are generic helpers.
  They serialize the application's own event type and do NOT claim the Anvia
  client protocol. Use them only for endpoints that intentionally expose a
  different event contract.

## Error exposure

Errors are masked by default. Use `mapError` only at the server adapter boundary
when the application intentionally exposes a safe error shape.
