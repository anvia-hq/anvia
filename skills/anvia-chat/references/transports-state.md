# Transports and State

## The boundary rule

Client-side `UIMessage[]` never crosses the server boundary. The request carries
core `Message[]`; the response carries framed `ClientStreamEvent` records.
Convert explicitly at the edges:

- `uiMessagesToMessages()` — client state to request. Rejects partial tool calls
  instead of replaying incomplete JSON or inventing empty arguments.
- `messagesToUIMessages()` — persisted core messages to UI state.
- `applyClientStreamEvent(messages, event)` — apply canonical stream events to
  `UIMessage[]`.
- `parseUIMessage` / `parseUIMessages` — validate externally loaded UI state.
- `parseClientStreamRequest` / `parseClientStreamEvent` / `parseClientStreamFrame`
  — validate public wire input at runtime.

`UIMessage.metadata` is application-owned and round-trips unchanged. Run details
(run ID, usage, context usage, status, trace correlation) live separately in
`UIMessage.generation`; converting persisted core messages hydrates usage into
that field and restores persisted sources as UI parts.

## Transports

```ts
// HTTP: framed JSONL or SSE, validates protocol header, frame order,
// stream identity, and event IDs.
const transport = createHttpClientTransport({ endpoint: "/api/chat" });

// Direct (same process / tests): same framed contract, no HTTP.
const transport = createDirectClientTransport({
  handler: ({ request, abortSignal }) => handleChat({ request, abortSignal }),
});
```

- Import transports, protocol types, `UIMessage`, and conversion helpers from
  `@anvia/client`. `@anvia/react` deliberately does not re-export them.
- Low-level JSONL/SSE readers live in `@anvia/client/transport`. They do not
  imply the client protocol — use them only for non-protocol endpoints.
- `UIToolMessagePart` states are exact: `input-streaming` carries raw partial
  text, `input-available` carries parsed JSON input, terminal `output-available`
  or `error` parts retain that input with their result.
- Tool-call start/delta/end events are automatic when the provider streams
  arguments.

## Agent interactions

- The browser never receives an `AgentContinuation`. The server retains it and
  atomically claims it by interaction ID. Agent interaction wire contracts come
  from the browser-safe `@anvia/core/agent/interactions` subpath — importing the
  client never loads the Agent runtime.
- Name interaction types from `@anvia/core/agent/interactions` when the app
  needs them.

## App-specific data

Application stream data is explicit and schema-validated:

```ts
type AppData = {
  citation_preview: { title: string; url: string };
};

const transport = createHttpClientTransport<ClientStreamRequest, AppData>({
  endpoint: "/api/chat",
  dataSchemas: { citation_preview: citationPreviewSchema },
});
```

Non-JSON tool outputs require an explicit `mapOutput`: returning `undefined`
omits the output, returning `null` exposes JSON `null`.
