# @anvia/openai

## 0.3.5

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

## 0.3.4

### Patch Changes

- ac73a10: Harden OpenAI embedding and image response validation.

## 0.3.3

### Patch Changes

- Updated dependencies [4c1620d]
  - @anvia/core@0.4.2

## 0.3.2

### Patch Changes

- Updated dependencies [95712d8]
  - @anvia/core@0.4.1

## 0.3.1

### Patch Changes

- c9728d4: Update upstream runtime dependencies to their latest compatible releases.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [b12932d]
  - @anvia/core@0.3.1

## 0.2.0

### Minor Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

### Patch Changes

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0

## 0.1.11

### Patch Changes

- 49e43a3: Update upstream runtime dependencies for Anthropic, Gemini, OpenAI, and Studio.

## 0.1.10

### Patch Changes

- Updated dependencies [a0a5def]
  - @anvia/core@0.2.4

## 0.1.9

### Patch Changes

- 1f7d3aa: Republish packages with registry-safe dependency metadata.

## 0.1.8

### Patch Changes

- 1ad360d: Fix Anthropic-compatible streaming tool inputs and update provider dependencies.
