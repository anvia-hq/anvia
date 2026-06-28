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

JSONL is the default transport format. Use `format: "sse"` when you need `text/event-stream` compatibility.
