# @anvia/server

Server-side stream helpers for Anvia applications.

```ts
import { createUIStreamResponse } from "@anvia/server";

return createUIStreamResponse(uiEvents, {
  format: "jsonl",
});
```

## Exports

- `createEventStream(events, options)` returns a streaming `Response`.
- `createUIStreamResponse(events, options)` returns a streaming `Response` for `UIStreamEvent` values.
- `createJsonlStream(events, options)` returns a JSONL `ReadableStream<Uint8Array>`.
- `createSseStream(events, options)` returns a Server-Sent Event `ReadableStream<Uint8Array>`.
- `createResumableStream(events, options)` wraps events in resumable stream envelopes.
- `resumeStreamEvents(options)` replays and tails events from a `ResumableStreamStore`.
- `createMemoryResumableStreamStore()` creates a single-process, non-durable resumable stream store.

JSONL is the default transport format. Use `format: "sse"` when you need `text/event-stream` compatibility.
Pass `resumable: { id, store }` to `createEventStream` when clients need to recover streams after
navigation or reload.
