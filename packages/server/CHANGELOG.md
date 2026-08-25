# @anvia/server

## 1.0.2

### Patch Changes

- @anvia/client@1.0.2

## 1.0.1

### Patch Changes

- @anvia/client@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
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
  - @anvia/client@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/client@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- @anvia/client@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- @anvia/client@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- @anvia/client@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/client@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- @anvia/client@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
  - @anvia/client@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @anvia/client@1.0.0-rc.4

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
- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [640dd3c]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
  - @anvia/client@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.7.6

### Patch Changes

- 0b8c4bb: Use the consumer's `@anvia/core` installation from React and Server so Studio targets do not
  resolve incompatible Agent and Pipeline class declarations from nested Core versions.

## 0.7.5

### Patch Changes

- Updated dependencies [461a04d]
  - @anvia/core@0.26.0

## 0.7.4

### Patch Changes

- Updated dependencies [615b767]
  - @anvia/core@0.25.1

## 0.7.3

### Patch Changes

- Updated dependencies [36f8324]
  - @anvia/core@0.25.0

## 0.7.2

### Patch Changes

- Updated dependencies [e55a792]
  - @anvia/core@0.24.0

## 0.7.1

### Patch Changes

- Updated dependencies [1285e70]
  - @anvia/core@0.23.0

## 0.7.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

### Patch Changes

- Updated dependencies [cf1dff7]
  - @anvia/core@0.22.0

## 0.6.0

### Minor Changes

- 1ff8304: Add first-class stream resume to the shared request and response APIs.

  `UIStreamRequest` now includes optional `resume: { streamId, after }`. `@anvia/server` adds a
  `createEventStream({ resume })` / `createUIStreamResponse({ resume })` overload so routes can
  continue in-flight streams without manually composing `resumeStreamEvents`.

### Patch Changes

- Updated dependencies [1ff8304]
  - @anvia/core@0.21.0

## 0.5.18

### Patch Changes

- Updated dependencies [f7eef6c]
  - @anvia/core@0.20.0

## 0.5.17

### Patch Changes

- Updated dependencies [d570f84]
  - @anvia/core@0.19.0

## 0.5.16

### Patch Changes

- Updated dependencies [eff30fb]
  - @anvia/core@0.18.0

## 0.5.15

### Patch Changes

- Updated dependencies [693ce2a]
  - @anvia/core@0.17.0

## 0.5.14

### Patch Changes

- Updated dependencies [32634d6]
  - @anvia/core@0.16.0

## 0.5.13

### Patch Changes

- Updated dependencies [ca24a5e]
  - @anvia/core@0.15.0

## 0.5.12

### Patch Changes

- Updated dependencies [d9ac48c]
  - @anvia/core@0.14.0

## 0.5.11

### Patch Changes

- Updated dependencies [9e190bc]
- Updated dependencies [ede828b]
  - @anvia/core@0.13.5

## 0.5.10

### Patch Changes

- Updated dependencies [d196025]
  - @anvia/core@0.13.4

## 0.5.9

### Patch Changes

- Updated dependencies [8b7fe0d]
  - @anvia/core@0.13.3

## 0.5.8

### Patch Changes

- Updated dependencies [b5f285a]
  - @anvia/core@0.13.2

## 0.5.7

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.
- Updated dependencies [433f642]
  - @anvia/core@0.13.1

## 0.5.6

### Patch Changes

- Updated dependencies [b52c479]
  - @anvia/core@0.13.0

## 0.5.5

### Patch Changes

- Updated dependencies [26efea0]
  - @anvia/core@0.12.8

## 0.5.4

### Patch Changes

- Updated dependencies [b54fba5]
  - @anvia/core@0.12.7

## 0.5.3

### Patch Changes

- Updated dependencies [70ae42c]
  - @anvia/core@0.12.6

## 0.5.2

### Patch Changes

- Updated dependencies [384c8f0]
  - @anvia/core@0.12.5

## 0.5.1

### Patch Changes

- Updated dependencies [327261f]
  - @anvia/core@0.12.4

## 0.5.0

### Minor Changes

- 3236568: Add resumable chat stream support with server-side resumable event envelopes, replay/tail helpers,
  an in-memory resumable stream store, and `useChat({ resume })` client resume state.

## 0.4.10

### Patch Changes

- Updated dependencies [6cd352e]
  - @anvia/core@0.12.3

## 0.4.9

### Patch Changes

- Updated dependencies [7b398eb]
  - @anvia/core@0.12.2

## 0.4.8

### Patch Changes

- Updated dependencies [2735197]
  - @anvia/core@0.12.1

## 0.4.7

### Patch Changes

- Updated dependencies [eed8b5f]
  - @anvia/core@0.12.0

## 0.4.6

### Patch Changes

- 264b92d: Restore React human-input hook state, harden overlapping chat sends, make fetch transports avoid implicit GET/HEAD bodies, and validate server-sent event control fields.

## 0.4.5

### Patch Changes

- Updated dependencies [32171dc]
  - @anvia/core@0.11.3

## 0.4.4

### Patch Changes

- Updated dependencies [730c23d]
  - @anvia/core@0.11.2

## 0.4.3

### Patch Changes

- Updated dependencies [9fc55c9]
  - @anvia/core@0.11.1

## 0.4.2

### Patch Changes

- Updated dependencies [4068a2a]
  - @anvia/core@0.11.0

## 0.4.1

### Patch Changes

- Updated dependencies [9e4de00]
  - @anvia/core@0.10.0

## 0.4.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

### Patch Changes

- Updated dependencies [ca25fca]
  - @anvia/core@0.9.0

## 0.3.1

### Patch Changes

- b80f013: Refactor stream helpers into focused internal modules, add coverage-gated tests, and omit stack traces from default streamed server error events.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.2.0

### Minor Changes

- eb90638: Add server stream response helpers and React client transports for JSONL and Server-Sent Event agent streams.
