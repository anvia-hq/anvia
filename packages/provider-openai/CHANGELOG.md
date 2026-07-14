# @anvia/openai

## 0.3.19

### Patch Changes

- b5f285a: Preserve streamed tool call names and provider call IDs when continuation chunks contain empty metadata placeholders.

## 0.3.18

### Patch Changes

- 433f642: Simplify provider request and response object construction while preserving adapter behavior.

## 0.3.17

### Patch Changes

- 204d342: Keep reasoning-only and empty assistant history compatible with providers that require content or tool calls.

## 0.3.16

### Patch Changes

- 498e95b: Preserve OpenAI refusal text and terminal Responses stream failure states in completion mappings.

## 0.3.15

### Patch Changes

- 32171dc: Add provider model-name types for autocomplete while preserving custom string model IDs.

## 0.3.14

### Patch Changes

- 0e33272: Update upstream runtime dependencies to their latest checked releases.

## 0.3.13

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.3.12

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.11

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.10

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.9

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.8

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.7

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.3.6

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

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
