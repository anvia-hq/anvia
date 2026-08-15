# @anvia/server

Server response helpers for the Anvia client protocol and explicitly generic event streams.

## Client protocol responses

Adapt native runtime events at the server boundary, then frame them for the client:

```ts
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";

const body = parseClientStreamRequest(await request.json());
const events = completionToClientStream(
  streamCompletion({ model, messages: body.messages }),
);

return createClientStreamResponse(events); // JSONL by default
```

`createClientStreamResponse(events, options)` always emits `stream_start`, ordered
`stream_event` frames, and `stream_end`, and sets
`x-anvia-stream-protocol: anvia.client.v1`. Use `format: "sse"` for SSE framing.

For resumable streams, pass `{ resumable: { streamId, store } }` when creating the response and
call `resumeClientStreamResponse({ streamId, after, store })` for a resume request.

## Generic event responses

`createEventStreamResponse(events, options)` and `resumeEventStreamResponse(options)` are separate,
generic helpers. They serialize the event type supplied by the application and do not claim that it
is the Anvia client protocol.

The lower-level exports are:

- `createJsonlStream(events, options)`
- `createSseStream(events, options)`
- `createResumableStream(events, options)`
- `resumeStreamEvents(options)`
- `createMemoryResumableStreamStore()`

There are no compatibility aliases for the removed ambiguous response APIs.
