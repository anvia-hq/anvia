# @anvia/studio

## 0.7.15

### Patch Changes

- @anvia/react@0.7.8
- @anvia/server@0.4.8

## 0.7.14

### Patch Changes

- @anvia/react@0.7.7
- @anvia/server@0.4.7

## 0.7.13

### Patch Changes

- Updated dependencies [264b92d]
  - @anvia/react@0.7.6
  - @anvia/server@0.4.6

## 0.7.12

### Patch Changes

- @anvia/react@0.7.5
- @anvia/server@0.4.5

## 0.7.11

### Patch Changes

- @anvia/react@0.7.4
- @anvia/server@0.4.4

## 0.7.10

### Patch Changes

- 9fc55c9: Update upstream runtime dependencies to their latest npm releases.
  - @anvia/react@0.7.3
  - @anvia/server@0.4.3

## 0.7.9

### Patch Changes

- Updated dependencies [4a3771d]
  - @anvia/react@0.7.2

## 0.7.8

### Patch Changes

- Updated dependencies [4068a2a]
  - @anvia/react@0.7.1
  - @anvia/server@0.4.2

## 0.7.7

### Patch Changes

- Updated dependencies [9e4de00]
  - @anvia/react@0.7.0
  - @anvia/server@0.4.1

## 0.7.6

### Patch Changes

- Updated dependencies [ca25fca]
  - @anvia/react@0.6.0
  - @anvia/server@0.4.0

## 0.7.5

### Patch Changes

- 9088549: Improve the Dynamic Tools knowledge view with structured tool reference cards, parameter tables, source details, and collapsed raw JSON metadata.

## 0.7.4

### Patch Changes

- f160948: Update Studio runtime and router dependencies.

## 0.7.3

### Patch Changes

- ac55f41: Refactor Studio routing and modularize the UI/runtime internals while preserving existing Studio behavior.

## 0.7.2

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.7.1

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.7.0

### Minor Changes

- ef5e727: Add centralized tool approval handling with tool-level approval policies and `.approvals(...)` decision handlers.

  Add React `useChat` human-input state for tool approvals and `ask_question` prompts, including helpers for approving, rejecting, and answering pending human input.

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0
  - @anvia/react@0.5.0

## 0.6.1

### Patch Changes

- 369b6c4: Refactor internal code quality: consolidate duplicate utilities, eliminate conditional spread patterns, and improve file organization.
- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.6.0

### Minor Changes

- e09746c: Add multi-provider model selection and multimodal attachment support to Studio, including cookbook documentation and assistant loading feedback in the playground.

## 0.5.14

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.5.13

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.5.12

### Patch Changes

- Updated dependencies [da736e9]
  - @anvia/react@0.4.0

## 0.5.11

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.5.10

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.5.9

### Patch Changes

- 71f7c61: Keep Studio's default session store in memory only, remove legacy Studio DB env defaults, and preserve agent-configured memory stores during Studio session runs.

## 0.5.8

### Patch Changes

- Updated dependencies [b80f013]
  - @anvia/react@0.3.1
  - @anvia/server@0.3.1

## 0.5.7

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

## 0.5.6

### Patch Changes

- 9cf2e11: Improve Studio runtime lookups, store helpers, UI splitting, and regression coverage.

## 0.5.5

### Patch Changes

- Updated dependencies [4c1620d]
  - @anvia/core@0.4.2

## 0.5.4

### Patch Changes

- 7eb7027: Update upstream wrapper dependencies to the latest available releases.

## 0.5.3

### Patch Changes

- Updated dependencies [95712d8]
  - @anvia/core@0.4.1

## 0.5.2

### Patch Changes

- 46dbd72: Use shared `@anvia/server` and `@anvia/react` stream helpers internally while preserving Studio stream behavior and UI transcript handling.

## 0.5.1

### Patch Changes

- c9728d4: Update upstream runtime dependencies to their latest compatible releases.

## 0.5.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

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
