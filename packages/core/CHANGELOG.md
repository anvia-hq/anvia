# @anvia/core

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
