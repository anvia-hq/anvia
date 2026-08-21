# @anvia/client

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- 6341fd8: Classify malformed provider tool arguments as typed retryable output failures, validate all tool
  calls before execution, preserve failed-attempt usage without exposing raw arguments, and reject
  truncated, filtered, incomplete, ambiguous, or non-JSON tool-call responses across first-party
  providers. Reject blank tool arguments and non-JSON provider options instead of inventing or
  coercing values. Align `JsonObject` with runtime validation by excluding explicit `undefined`
  properties while accepting immutable JSON arrays. Apply the same strict provider-options boundary
  to completion, image, speech, and transcription calls. Require finite strict JSON for eval inputs
  and parsed results instead of coercing them. Keep streaming retries disabled after observable
  provider progress.
  Validate React composer entity data as finite strict JSON at trigger, submission, and message
  rendering boundaries.
  Require MCP tool arguments to be strict JSON objects; only an explicit `undefined` direct call
  omits the remote arguments field.
  Make client tool-part states exact: completed results retain their original input, impossible state
  combinations are rejected, and partial streamed arguments can never be replayed as model input.
- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- e96d038: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- c7f4bbc: Move durable memory selection onto the object-only Agent generate and stream boundaries, remove
  AgentSession and positional execution signatures, and distinguish stateful prompts from stateless
  transcripts. Replace implicit compaction summaries with explicit MemoryScope, store capability,
  typed compaction-message, result metadata, and stream-event contracts. Persist compaction messages
  atomically in every memory adapter and carry compaction events through Client, React, resumable
  server streams, and Studio logs without creating synthetic chat messages.
- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
- a4bf9d2: Bind provider and local-model handles to explicit model IDs, make remote provider factories
  object-only, and introduce honest local loading and ownership boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [1f6db5c]
- Updated dependencies [5476f98]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0-rc.2
