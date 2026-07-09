# @anvia/core

## 0.12.6

### Patch Changes

- 70ae42c: Preserve streamed and replayed tool result ordering across text/tool boundaries.

## 0.12.5

### Patch Changes

- 384c8f0: Preserve tool result names when rehydrating persisted UI messages from core messages.

## 0.12.4

### Patch Changes

- 327261f: Preserve streamed assistant content part order when reconstructing final streaming responses.

## 0.12.3

### Patch Changes

- 6cd352e: Fix agent option isolation, deterministic regex eval metrics, and MCP client version metadata.

## 0.12.2

### Patch Changes

- 7b398eb: Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
  Merge raw agent tool-call results back into the originating tool part when provider and internal call ids differ.
  Add UI attachment contracts, chat suggestions, composer attachments, auto-resizing composer input, Markdown rendering, granular tool primitives, thread status helpers, expanded human-input controls, controlled composer state, custom composer submit handlers, optional empty collection mounting, and thinner headless defaults.

## 0.12.1

### Patch Changes

- 2735197: Remove experimental tool and tool-result guardrails. Guardrail policies now cover input and final output boundaries only; use tool approvals, hooks, middleware, and service-level validation for tool execution behavior.

## 0.12.0

### Minor Changes

- eed8b5f: Add experimental guardrail policies for input, tool calls, tool results, and final output.

## 0.11.3

### Patch Changes

- 32171dc: Add provider model-name types for autocomplete while preserving custom string model IDs.

## 0.11.2

### Patch Changes

- 730c23d: Clean up request internals by moving prompt runtime implementation details behind the internal source boundary while preserving the public request API.

## 0.11.1

### Patch Changes

- 9fc55c9: Update upstream runtime dependencies to their latest npm releases.

## 0.11.0

### Minor Changes

- 4068a2a: Send converted core messages from React hooks and keep completion helpers limited to core `Message` input.

## 0.10.0

### Minor Changes

- 9e4de00: Improve completion stream DX by allowing `createCompletionStream()` and `createCompletion()` to accept UI messages directly, and by letting React hooks consume raw completion or agent stream events without a separate UI stream adapter.

## 0.9.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

## 0.8.0

### Minor Changes

- 3de3cce: Add an optional `update?` hook on `AgentGenerationObserver` so
  observability adapters can record streaming deltas as they arrive.

  The agent loop now awaits `observer.update?.({ turn, delta })` for
  every delta produced by the underlying completion stream. The new
  method is optional, so existing adapters keep working. A new
  `AgentGenerationUpdateArgs` type is exported alongside.

- 3de3cce: Add an optional `event?` hook on `AgentRunObserver` so
  observability adapters can record ad-hoc checkpoints (e.g.
  retrieval, validation) during a run.

  The new method accepts an `AgentRunEventArgs` value with a `name`,
  optional `attributes` map, optional `level`, and optional
  `timestamp`. The hook is optional, so existing adapters keep
  working without modification.

- 3de3cce: Add an optional `promptRef?: { name; version? }` field on
  `AgentRunStartArgs`. Observability adapters can use this to
  record the prompt name and version on the trace root and on
  each generation in the run.

  The new field is optional, so existing call sites keep
  compiling. The `AgentRunPromptRef` type is also exported
  alongside.

- 3de3cce: Extend the `EvalMetric` type with optional Langfuse-related
  annotations: `dataType`, `scoreConfigId`, `configId`, and
  `metadata`. All fields are optional, so existing metric definitions
  keep compiling unchanged.

  Add a `defineMetric()` identity helper that wraps a metric
  definition for clearer intent at call sites. Re-export it from
  `@anvia/core/evals`.

## 0.7.1

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.

## 0.7.0

### Minor Changes

- ef5e727: Add centralized tool approval handling with tool-level approval policies and `.approvals(...)` decision handlers.

  Add React `useChat` human-input state for tool approvals and `ask_question` prompts, including helpers for approving, rejecting, and answering pending human input.

## 0.6.3

### Patch Changes

- 369b6c4: Refactor internal code quality: consolidate duplicate utilities, eliminate conditional spread patterns, and improve file organization.

## 0.6.2

### Patch Changes

- 4806f3e: Add `PromptRequest.steer()` for enqueueing user messages at safe model-turn boundaries during active prompt runs.

## 0.6.1

### Patch Changes

- 2d039f6: Add ergonomic tool result message helpers and export `ToolContent` from the root entrypoint.

## 0.6.0

### Minor Changes

- e54aece: Add direct completion helpers for non-streaming, streaming, and parsed structured output flows.

  `createCompletion` now always returns a final completion result, `createCompletionStream` exposes raw normalized model stream events, and `createParsedCompletion` returns schema-validated data from direct completions.

## 0.5.0

### Minor Changes

- 4ab66c9: Broaden agent runtime hooks and add general middleware for completion requests, completion responses, tool inputs, and tool outputs while keeping existing tool middleware APIs as deprecated aliases.

## 0.4.2

### Patch Changes

- 4c1620d: Harden MCP connection cleanup and vector dimension validation, and organize loader internals without changing public loader APIs.

## 0.4.1

### Patch Changes

- 95712d8: Refactor core internals for improved maintainability while preserving public API and behavior.

## 0.4.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.3.1

### Patch Changes

- b12932d: Update upstream dependencies for PDF loading, globbing, Langfuse tracing, and pgvector support.

  The PDF loader now destroys the `pdfjs-dist` loading task after reading pages, matching the v6 cleanup API.

## 0.3.0

### Minor Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

## 0.2.4

### Patch Changes

- a0a5def: Preserve accumulated streamed tool arguments when a provider final response contains an empty tool input.
