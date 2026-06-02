# @anvia/studio

## 0.4.1

### Patch Changes

- 6c53426: Make Studio UI routes consistently use the configured UI path, add the missing Evals shell route, restore the dynamic tools Knowledge tab, and make runtime JSON serialization safe for cyclic model metadata.

## 0.4.0

### Minor Changes

- b542b87: Add Studio inspection surfaces for memory, runtime status, richer agent metadata, direct tool invocation, pipeline replay controls, realtime observability events, and eval suite runs, with in-memory storage as the default and optional SQLite persistence.

### Patch Changes

- b542b87: Allow Studio to accept typed pipelines with arbitrary input and output types, and update the cookbook Studio inspection example to point at the correct UI routes.

## 0.3.0

### Minor Changes

- e74df22: Add Studio inspection surfaces for memory, runtime status, richer agent metadata, direct tool invocation, pipeline replay controls, realtime observability events, and eval suite runs, with in-memory storage as the default and optional SQLite persistence.

## 0.2.11

### Patch Changes

- Updated dependencies [b12932d]
  - @anvia/core@0.3.1

## 0.2.10

### Patch Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0

## 0.2.9

### Patch Changes

- 49e43a3: Update upstream runtime dependencies for Anthropic, Gemini, OpenAI, and Studio.

## 0.2.8

### Patch Changes

- 896ae21: Update upstream provider and runtime dependencies.

## 0.2.7

### Patch Changes

- a0a5def: Lazy-load the default SQLite store so importing Studio does not require `node:sqlite` in Bun-compatible runtimes.
- Updated dependencies [a0a5def]
  - @anvia/core@0.2.4

## 0.2.6

### Patch Changes

- 1f7d3aa: Republish packages with registry-safe dependency metadata.

## 0.2.5

### Patch Changes

- 1ad360d: Fix Anthropic-compatible streaming tool inputs and update provider dependencies.

## 0.2.4

### Patch Changes

- 1e5b78d: Polish the Studio UI with updated sidebar, page surfaces, tracing views, playground logs, transcript auto-scroll, and full-width markdown tables.
