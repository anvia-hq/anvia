# @anvia/client

## 1.3.5

### Patch Changes

- 27f8bc3: Allow durable goals to select an agent per submission, with an optional definition-level
  default. Capture the effective agent in the goal checkpoint and expose it to assessment code.
  Validate registration before accepting submissions through both goal and task APIs.

  Preserve legacy goal inputs and assessment journals across recovery. Missing registrations
  between sessions now require attention and can be retried after re-registering the agent.
  Extend the client and server peer ranges to accept the compatible durable 0.6 minor release.

  Authorize HTTP task submissions against each effective registered agent before creating work,
  including definition defaults and persisted goal bindings. Reject bindings changed during
  authorization. HTTP task submission requires durable 0.6 or newer and fails closed on older
  runtimes; existing run routes keep their compatibility.

## 1.3.4

### Patch Changes

- 676050a: Add durable goals that continue across bounded agent sessions with persisted handoffs,
  application-verified completion, cumulative model-turn budgets, admission token/deadline limits,
  stall detection, and explicit signal-based resumption. Preserve typed turn exhaustion and partial
  messages, and expose capped owned-agent spawning and direct child run inspection.

  SQLite journals upgrade to schema 7; older engines reject upgraded databases.
  Allow the new durable minor line in client/server peer dependencies.
  Document goal orchestration in the bundled durable skill.

## 1.3.3

### Patch Changes

- 0f2a6a6: Add opt-in conversation compaction on durable agent registrations. Summarize completed history
  while retaining recent complete turns and preserving canonical messages. Persist summary
  checkpoints, projected input, usage, and progress atomically for recovery, with bounded summary
  attempts using the model retry policy.

  SQLite schemas 1–5 upgrade to schema 6 when acquired. Use matching durable runtime and protocol
  consumers; older engines reject the upgraded database. Compaction runs between session runs and inside active tool loops; graph tasks remain excluded.

  Allow the durable 0.4 minor line in client and server peer compatibility ranges.

## 1.3.2

### Patch Changes

- 9320061: Accept core structured user messages as durable prompts, enabling image and document inputs in runs, graph tasks, and owned agents. Validate multimodal content, preserve it across history and recovery, and compare request identities by canonical JSON. Existing string prompts remain supported. Allow the durable 0.3 release line in the client and server peer ranges.

## 1.3.1

### Patch Changes

- ee52a9f: Declare compatibility with both durable 0.1 and 0.2 through an optional peer range. Keep client and server on their existing major versions when durable receives a minor release.

## 1.3.0

### Minor Changes

- a1c7b45: Fail closed on durable storage errors across agent and custom-task execution. Add readiness,
  aggregate metrics, configurable admission/payload/operation limits, and offline SQLite backup
  and restoration to new files. Durable now requires Node.js 22.16 or newer and custom stores
  must implement capacity-count and metrics methods.

  Expose registered custom-task submission, snapshots, ownership graphs, signals, effect
  reconciliation, retry, cancellation, and reconnectable events through the server and browser
  client. Map owned agent authorization to its parent session and include root task identity
  in task event envelopes. The durable package remains experimental.

- a1c7b45: Add paginated durable run discovery, opt-in persisted session queues, bounded concurrency,
  and opt-in model retries with persisted attempt budgets and backoff deadlines. Capture queued
  session history only when execution starts and preserve conservative tool recovery policies.

  Add authorized Fetch-compatible durable HTTP routes and a browser-safe client with validated
  snapshots and cursor-based SSE reconnection. Add native SSE event IDs and producer cancellation
  callbacks to server stream helpers. Preserve node:sqlite imports in the durable package build.

  Document the scheduling and HTTP contracts. External documentation should include the new subpath exports,
  queue/retry statuses, authorization boundary, and reconnect flow.

- a1c7b45: Add persisted static task graphs with validated dependencies, parallel ready tasks, successful
  prerequisite gating, and committed dependency outputs. Expose atomic topology/state snapshots,
  explicit waiting reasons, correlated task events, graph discovery, and cancellation.

  Add graph HTTP/client methods and authorize child-run access against the owning graph session.
  Upgrade SQLite schema 1 to 2 on acquisition so older engines cannot bypass dependency scheduling.
  Document automatic readiness/recovery versus explicit approvals and reconciliation, with
  SIGKILL recovery and authorization test coverage.

## 1.2.1

### Patch Changes

- a32e40c: Refresh package READMEs with concise product overviews, current quickstarts, and links to detailed guides. Publish the updated documentation on npm.

## 1.2.0

### Minor Changes

- 13e7346: Export the `isJsonValue` JSON-safety guard from the package entrypoint so server
  and application stream serializers can validate payloads with the same rules the
  client protocol uses.

## 1.1.3

### Patch Changes

- 0d9bce0: Declare compatible workspace peer ranges so additive internal dependency releases do not force major releases of dependents.

## 1.1.2

### Patch Changes

- Updated dependencies [f998fd6]
  - @anvia/core@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [f48bb95]
  - @anvia/core@1.1.1

## 1.0.11

### Patch Changes

- Updated dependencies [2277090]
  - @anvia/core@1.0.10

## 1.0.10

### Patch Changes

- c8bea68: Hydrate persisted assistant usage, context usage, and sources into replayed UI messages while keeping
  per-generation usage separate from aggregate run usage. Keep latest-context state aligned when a
  new response omits context information. Expose the latest aggregate run usage as
  `useChat().runUsage` and completion usage as `useCompletion().usage`.

## 1.0.9

### Patch Changes

- Updated dependencies [68953da]
  - @anvia/core@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [18344a2]
  - @anvia/core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [9e5e068]
  - @anvia/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [32cffc0]
  - @anvia/core@1.0.6

## 1.0.5

### Patch Changes

- c7fb0f8: Declare and verify Bun 1.3.14 runtime compatibility for the built packages, public Core exports,
  Client and Server streaming, OpenAI SDK transport and media paths, and MCP HTTP/SSE and stdio
  transports. Make structured tool output branding stable across multiple Core module instances.
- Updated dependencies [c7fb0f8]
  - @anvia/core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [c7c45a9]
  - @anvia/core@1.0.2

## 1.0.1

### Patch Changes

- @anvia/core@1.0.1

## 1.0.0

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 0292ede: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- a90416c: Classify malformed provider tool arguments as typed retryable output failures, validate all tool
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
- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- c7f4bbc: Move durable memory selection onto the object-only Agent generate and stream boundaries, remove
  AgentSession and positional execution signatures, and distinguish stateful prompts from stateless
  transcripts. Replace implicit compaction summaries with explicit MemoryScope, store capability,
  typed compaction-message, result metadata, and stream-event contracts. Persist compaction messages
  atomically in every memory adapter and carry compaction events through Client, React, resumable
  server streams, and Studio logs without creating synthetic chat messages.
- 45882ab: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- 45882ab: Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
  Add a customizable token counter, token counts to compaction results and stream events, and
  `Agent.compactMemory()` for explicit manual compaction.
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
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [07a1e6c]
- Updated dependencies [0292ede]
- Updated dependencies [007b132]
- Updated dependencies [c0c6cb8]
- Updated dependencies [a90416c]
- Updated dependencies [1dfb4f3]
- Updated dependencies [07a1e6c]
- Updated dependencies [8dc2dfb]
- Updated dependencies [6354116]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [9cb661c]
- Updated dependencies [1f6db5c]
- Updated dependencies [5ec61e3]
- Updated dependencies [5476f98]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [0292ede]
- Updated dependencies [4ab25bb]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- 995add8: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- 9e6df68: Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
  Add a customizable token counter, token counts to compaction results and stream events, and
  `Agent.compactMemory()` for explicit manual compaction.
- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10

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
