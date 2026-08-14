# @anvia/anthropic

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.5.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.5.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

## 0.4.1

### Patch Changes

- 693ce2a: Trace complete model inputs and nested agent generations in Langfuse with safe and full capture
  modes, consistent redaction, native prompt and time-to-first-token attributes, and reliable score
  queue flushing. Normalize provider token totals and expose mutually exclusive usage detail buckets
  for accurate cache- and reasoning-aware cost inference.

## 0.4.0

### Minor Changes

- fa8a398: Add first-class Google Vertex authentication options for Gemini and a dedicated Anthropic Vertex
  client with Application Default Credentials and custom Google authentication support.

## 0.3.16

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.3.15

### Patch Changes

- 433f642: Simplify provider request and response object construction while preserving adapter behavior.

## 0.3.14

### Patch Changes

- 8f7ba97: Update upstream runtime dependencies for provider, vector, and observability adapters.

## 0.3.13

### Patch Changes

- 7326e6a: Update upstream runtime dependencies for provider, vector store, observability, and Studio packages.

## 0.3.12

### Patch Changes

- 32171dc: Add provider model-name types for autocomplete while preserving custom string model IDs.

## 0.3.11

### Patch Changes

- 0e33272: Update upstream runtime dependencies to their latest checked releases.

## 0.3.10

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.3.9

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.8

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.7

### Patch Changes

- ae9296f: Report Anthropic Messages streaming usage from message start and delta events.

## 0.3.6

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.5

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.3.4

### Patch Changes

- 4c76d8d: Harden non-OpenAI provider response validation and package-local build scripts.

## 0.3.3

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

## 0.3.2

### Patch Changes

- 7eb7027: Update upstream wrapper dependencies to the latest available releases.

## 0.3.1

### Patch Changes

- c9728d4: Update upstream runtime dependencies to their latest compatible releases.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

## 0.2.0

### Minor Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

### Patch Changes

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0

## 0.1.10

### Patch Changes

- 49e43a3: Update upstream runtime dependencies for Anthropic, Gemini, OpenAI, and Studio.

## 0.1.9

### Patch Changes

- 896ae21: Update upstream provider and runtime dependencies.

## 0.1.8

### Patch Changes

- 1ad360d: Fix Anthropic-compatible streaming tool inputs and update provider dependencies.
