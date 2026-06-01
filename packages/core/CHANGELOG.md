# @anvia/core

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
