# @anvia/mistral

## 0.2.1

### Patch Changes

- Updated dependencies [95712d8]
  - @anvia/core@0.4.1

## 0.2.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

## 0.1.6

### Patch Changes

- Updated dependencies [b12932d]
  - @anvia/core@0.3.1

## 0.1.5

### Patch Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [a0a5def]
  - @anvia/core@0.2.4
