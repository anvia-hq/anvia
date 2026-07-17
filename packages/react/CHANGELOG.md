# @anvia/react

## 0.8.13

### Patch Changes

- Updated dependencies [9e190bc]
- Updated dependencies [ede828b]
  - @anvia/core@0.13.5

## 0.8.12

### Patch Changes

- 891caf2: Add cancellable Studio agent streams with partial transcript persistence, cancelled human-input states, and persisted response durations.

## 0.8.11

### Patch Changes

- Updated dependencies [d196025]
  - @anvia/core@0.13.4

## 0.8.10

### Patch Changes

- Updated dependencies [8b7fe0d]
  - @anvia/core@0.13.3

## 0.8.9

### Patch Changes

- Updated dependencies [b5f285a]
  - @anvia/core@0.13.2

## 0.8.8

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.
- Updated dependencies [433f642]
  - @anvia/core@0.13.1

## 0.8.7

### Patch Changes

- b52c479: Persist strict JSON message metadata across UI and core message conversions while keeping it out of provider requests and model-generation trace inputs.
- Updated dependencies [b52c479]
  - @anvia/core@0.13.0

## 0.8.6

### Patch Changes

- 6448b3e: Add opt-in, reduced-motion-aware display smoothing for streamed text and Markdown without changing chat state or transport behavior.

## 0.8.5

### Patch Changes

- Updated dependencies [26efea0]
  - @anvia/core@0.12.8

## 0.8.4

### Patch Changes

- b54fba5: Scope live UI tool result matching by turn when reducer events include turn metadata.
- Updated dependencies [b54fba5]
  - @anvia/core@0.12.7

## 0.8.3

### Patch Changes

- 70ae42c: Preserve streamed and replayed tool result ordering across text/tool boundaries.
- Updated dependencies [70ae42c]
  - @anvia/core@0.12.6

## 0.8.2

### Patch Changes

- Updated dependencies [384c8f0]
  - @anvia/core@0.12.5

## 0.8.1

### Patch Changes

- Updated dependencies [327261f]
  - @anvia/core@0.12.4

## 0.8.0

### Minor Changes

- 3236568: Add resumable chat stream support with server-side resumable event envelopes, replay/tail helpers,
  an in-memory resumable stream store, and `useChat({ resume })` client resume state.

## 0.7.11

### Patch Changes

- 8e6fc0c: Add `initialMessagesFromMemory` for hydrating React chat state from Anvia memory messages.

## 0.7.10

### Patch Changes

- Updated dependencies [6cd352e]
  - @anvia/core@0.12.3

## 0.7.9

### Patch Changes

- 7b398eb: Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
  Merge raw agent tool-call results back into the originating tool part when provider and internal call ids differ.
  Add UI attachment contracts, chat suggestions, composer attachments, auto-resizing composer input, Markdown rendering, granular tool primitives, thread status helpers, expanded human-input controls, controlled composer state, custom composer submit handlers, optional empty collection mounting, and thinner headless defaults.
- Updated dependencies [7b398eb]
  - @anvia/core@0.12.2

## 0.7.8

### Patch Changes

- Updated dependencies [2735197]
  - @anvia/core@0.12.1

## 0.7.7

### Patch Changes

- Updated dependencies [eed8b5f]
  - @anvia/core@0.12.0

## 0.7.6

### Patch Changes

- 264b92d: Restore React human-input hook state, harden overlapping chat sends, make fetch transports avoid implicit GET/HEAD bodies, and validate server-sent event control fields.

## 0.7.5

### Patch Changes

- Updated dependencies [32171dc]
  - @anvia/core@0.11.3

## 0.7.4

### Patch Changes

- Updated dependencies [730c23d]
  - @anvia/core@0.11.2

## 0.7.3

### Patch Changes

- Updated dependencies [9fc55c9]
  - @anvia/core@0.11.1

## 0.7.2

### Patch Changes

- 4a3771d: Append `useCompletion` turns to existing message state before sending requests.

## 0.7.1

### Patch Changes

- 4068a2a: Send converted core messages from React hooks and keep completion helpers limited to core `Message` input.
- Updated dependencies [4068a2a]
  - @anvia/core@0.11.0

## 0.7.0

### Minor Changes

- 9e4de00: Improve completion stream DX by allowing `createCompletionStream()` and `createCompletion()` to accept UI messages directly, and by letting React hooks consume raw completion or agent stream events without a separate UI stream adapter.

### Patch Changes

- Updated dependencies [9e4de00]
  - @anvia/core@0.10.0

## 0.6.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

### Patch Changes

- Updated dependencies [ca25fca]
  - @anvia/core@0.9.0

## 0.5.0

### Minor Changes

- ef5e727: Add centralized tool approval handling with tool-level approval policies and `.approvals(...)` decision handlers.

  Add React `useChat` human-input state for tool approvals and `ask_question` prompts, including helpers for approving, rejecting, and answering pending human input.

## 0.4.0

### Minor Changes

- da736e9: Add `useCompletion` hook for single-prompt text completion streaming and `createDirectTransport` for in-process transport without HTTP.

## 0.3.1

### Patch Changes

- b80f013: Refactor stream helpers into focused internal modules, add coverage-gated tests, and omit stack traces from default streamed server error events.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.2.0

### Minor Changes

- eb90638: Add server stream response helpers and React client transports for JSONL and Server-Sent Event agent streams.
