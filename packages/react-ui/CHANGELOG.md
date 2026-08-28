# @anvia/react-ui

## 1.0.6

### Patch Changes

- @anvia/client@1.0.6
- @anvia/react@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/client@1.0.5
  - @anvia/react@1.0.5

## 1.0.4

### Patch Changes

- @anvia/client@1.0.4
- @anvia/react@1.0.4

## 1.0.3

### Patch Changes

- @anvia/client@1.0.3
- @anvia/react@1.0.3

## 1.0.2

### Patch Changes

- @anvia/client@1.0.2
- @anvia/react@1.0.2

## 1.0.1

### Patch Changes

- f29f2f6: Refresh upstream SDK and runtime dependencies to their latest supported releases.
  - @anvia/client@1.0.1
  - @anvia/react@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 07a1e6c: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.
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
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- b363c93: Update upstream runtime dependencies and preserve compatibility with the latest Anthropic SDKs.
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [0292ede]
- Updated dependencies [a90416c]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [809d3b0]
  - @anvia/react@1.0.0
  - @anvia/client@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/client@1.0.0-rc.11
  - @anvia/react@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- 928315b: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.
  - @anvia/client@1.0.0-rc.10
  - @anvia/react@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- @anvia/client@1.0.0-rc.9
- @anvia/react@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- @anvia/client@1.0.0-rc.8
- @anvia/react@1.0.0-rc.8

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
  - @anvia/client@1.0.0-rc.7
  - @anvia/react@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- @anvia/client@1.0.0-rc.6
- @anvia/react@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- e96d038: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- Updated dependencies [e96d038]
  - @anvia/client@1.0.0-rc.5
  - @anvia/react@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @anvia/client@1.0.0-rc.4
- @anvia/react@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- Updated dependencies [475ae22]
  - @anvia/client@1.0.0-rc.3
  - @anvia/react@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- b363c93: Update upstream runtime dependencies and preserve compatibility with the latest Anthropic SDKs.
- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [640dd3c]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [809d3b0]
  - @anvia/client@1.0.0-rc.2
  - @anvia/react@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- @anvia/react@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
  - @anvia/react@1.0.0-rc.0

## 0.7.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.7.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

## 0.6.3

### Patch Changes

- 1684893: Prevent settled Markdown text from fading again when streaming resumes after a pause, preserve
  in-progress reveal timing across appended chunks, and render reveal text fully opaque when reduced
  motion is requested.

## 0.6.2

### Patch Changes

- 7f4ce71: Update upstream runtime patch dependencies for React UI and Studio packages.

## 0.6.1

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.6.0

### Minor Changes

- 129f37c: Replace stream animation presets with lifecycle-driven, buffered smoothing for text and ordered
  mixed items. Add stable-block live Markdown rendering and use the pipeline in the Studio Playground
  transcript.

## 0.5.1

### Patch Changes

- 433f642: Simplify conditional UI property construction while preserving rendered behavior and the public API.

## 0.5.0

### Minor Changes

- bc1aef3: Render validated Composer entities as headless semantic markup in `Message.Markdown`, with `Message.Entity` and `renderEntity` customization APIs.

### Patch Changes

- feb5955: Keep Composer entity ranges aligned when default submission prefixes message text with a quote.

## 0.4.3

### Patch Changes

- 6448b3e: Add opt-in, reduced-motion-aware display smoothing for streamed text and Markdown without changing chat state or transport behavior.

## 0.4.2

### Patch Changes

- 072451a: Make `Composer.Input` lifecycle-safe when trigger changes recreate its Tiptap editor.

## 0.4.1

### Patch Changes

- b8bb855: Clear the default chat composer immediately after starting message submission instead of waiting for the response stream.

## 0.4.0

### Minor Changes

- 3898f6d: Add a Tiptap-backed rich `Composer.Input` with composable trigger/entity metadata support.

  `Composer.Input` now renders a rich editor instead of a native textarea. Use
  `Composer.TextareaInput` for the previous textarea behavior.

## 0.3.0

### Minor Changes

- 0bdb305: Add Image, SelectionToolbar, and ThreadList primitive namespaces. Composer now supports controlled quote state for selection quoting, and message roots expose stable message id attributes for selection-aware UI.

## 0.2.0

### Minor Changes

- 7b398eb: Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
  Merge raw agent tool-call results back into the originating tool part when provider and internal call ids differ.
  Add UI attachment contracts, chat suggestions, composer attachments, auto-resizing composer input, Markdown rendering, granular tool primitives, thread status helpers, expanded human-input controls, controlled composer state, custom composer submit handlers, optional empty collection mounting, and thinner headless defaults.

## 0.1.0

### Minor Changes

- Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
