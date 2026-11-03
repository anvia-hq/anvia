---
"@anvia/client": minor
---

Add `@anvia/client/durable-chat`, a `ClientTransport` adapter that lets `useChat` from
`@anvia/react` and the `@anvia/react-ui` chat primitives talk to `@anvia/durable`.

- `createDurableChatTransport({ client, agentId, sessionId, requestId?, enqueue? })` submits the
  last user message, maps durable journal events to `anvia.client.v3` frames, routes interaction
  responses to the active run, and uses the durable run id and sequence for resume.
- The transport exposes `controller` with `activeRunId`, `reattach`, `cancel`, `retry`, and
  `resolveTool`. Aborting the stream detaches only and never cancels the run.
- A busy session (HTTP 409) surfaces as `DurableBusyError` with the run to reattach to.
- The pure event mapping is exported from the same entry point for reuse by a future server bridge.
