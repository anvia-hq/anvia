# @anvia/react

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
