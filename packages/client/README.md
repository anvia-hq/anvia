# @anvia/client

Framework-neutral client protocol, transports, message conversion, and stream state for Anvia.

`@anvia/core` owns native completion and Agent events. `@anvia/client` owns the public wire boundary:

```ts
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";

const request = parseClientStreamRequest(await httpRequest.json());
const events = completionToClientStream(
  streamCompletion({ model, messages: request.messages }),
);
```

The request carries core `Message[]`; client-side `UIMessage[]` never crosses the server boundary.
The response uses `ClientStreamEvent` records inside an always-framed `anvia.client.v1` stream.

## Public API

- `completionToClientStream(events, options)` adapts native completion events.
- `agentToClientStream(events, options)` adapts native Agent events, including nested-agent scope.
- `parseClientStreamRequest`, `parseClientStreamEvent`, and `parseClientStreamFrame` validate public
  input at runtime.
- `createHttpClientTransport(options)` consumes framed JSONL or SSE responses and validates the
  protocol header, frame order, stream identity, and event IDs.
- `createDirectClientTransport(handler)` provides the same framed contract without HTTP.
- `messagesToUIMessages` and `uiMessagesToMessages` explicitly convert server messages and UI
  state.
- `applyClientStreamEvent(messages, event)` applies canonical events to `UIMessage[]` state.

Tool-call start, delta, and end events are automatic when the provider exposes streamed arguments.
Errors are masked by default. Use `mapError` only at the server adapter boundary when an application
intentionally exposes a safe error shape. Non-JSON outputs require an explicit `mapOutput`.

Application-specific stream data is explicit and schema-validated:

```ts
type AppData = {
  citation_preview: { title: string; url: string };
};

const transport = createHttpClientTransport<ClientStreamRequest, AppData>({
  endpoint: "/api/chat",
  dataSchemas: {
    citation_preview: citationPreviewSchema,
  },
});
```

Low-level generic JSONL/SSE readers and event transports are available from
`@anvia/client/transport`. They do not imply the Anvia client protocol; use them only for endpoints
that intentionally expose a different event contract.
