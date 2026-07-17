# @anvia/studio

## 0.7.35

### Patch Changes

- 9e190bc: Persist provider, model, and per-generation token usage on generated assistant messages, and show
  those durable response metrics in Studio's Memory inspector.
- ede828b: Add optional read-only memory inspection, implement it across the database memory adapters, and let
  Studio discover persisted agent conversations before falling back to Studio session storage.
- 9e190bc: Show a dynamic spinner and elapsed time while a response is streaming, then label the stored final
  duration as a finished status beside the response action icons. Render the streaming stop action
  with a solid stop icon.
  - @anvia/react@0.8.13
  - @anvia/server@0.5.11

## 0.7.34

### Patch Changes

- 24d42ab: Automatically expose sandbox-backed agent workspaces in Studio through read-only APIs and a
  dedicated Sandboxes inspector. Studio servers can also leave SIGINT handling to the application or
  use the managed `serve(...)` lifecycle to await asynchronous resource cleanup.
- 891caf2: Add cancellable Studio agent streams with partial transcript persistence, cancelled human-input states, and persisted response durations.
- Updated dependencies [891caf2]
  - @anvia/react@0.8.12

## 0.7.33

### Patch Changes

- @anvia/react@0.8.11
- @anvia/server@0.5.10

## 0.7.32

### Patch Changes

- @anvia/react@0.8.10
- @anvia/server@0.5.9

## 0.7.31

### Patch Changes

- @anvia/react@0.8.9
- @anvia/server@0.5.8

## 0.7.30

### Patch Changes

- 433f642: Replace the generic compact helper and conditional object spreads with explicit optional assignments while preserving the Studio public API.
- Updated dependencies [433f642]
  - @anvia/react@0.8.8
  - @anvia/server@0.5.7

## 0.7.29

### Patch Changes

- 83b36e2: Preserve strict JSON message metadata in durable memory adapters and Studio's normalized SQLite session storage.

## 0.7.28

### Patch Changes

- Updated dependencies [b52c479]
  - @anvia/react@0.8.7
  - @anvia/server@0.5.6

## 0.7.27

### Patch Changes

- Updated dependencies [6448b3e]
  - @anvia/react@0.8.6

## 0.7.26

### Patch Changes

- @anvia/react@0.8.5
- @anvia/server@0.5.5

## 0.7.25

### Patch Changes

- Updated dependencies [b54fba5]
  - @anvia/react@0.8.4
  - @anvia/server@0.5.4

## 0.7.24

### Patch Changes

- Updated dependencies [70ae42c]
  - @anvia/react@0.8.3
  - @anvia/server@0.5.3

## 0.7.23

### Patch Changes

- @anvia/react@0.8.2
- @anvia/server@0.5.2

## 0.7.22

### Patch Changes

- @anvia/react@0.8.1
- @anvia/server@0.5.1

## 0.7.21

### Patch Changes

- Updated dependencies [3236568]
  - @anvia/react@0.8.0
  - @anvia/server@0.5.0

## 0.7.20

### Patch Changes

- Updated dependencies [8e6fc0c]
  - @anvia/react@0.7.11

## 0.7.19

### Patch Changes

- @anvia/react@0.7.10
- @anvia/server@0.4.10

## 0.7.18

### Patch Changes

- Updated dependencies [7b398eb]
  - @anvia/react@0.7.9
  - @anvia/server@0.4.9

## 0.7.17

### Patch Changes

- 7326e6a: Update upstream runtime dependencies for provider, vector store, observability, and Studio packages.

## 0.7.16

### Patch Changes

- f6860b9: Redesign the Studio Knowledge dynamic tools, Memory, and Status inspector pages.
- fff056f: Expose MCP server origin on Studio tool metadata and run MCP-backed tools directly from the Studio MCP screen.
- edc4aeb: Accept shared UI-style agent run requests and reuse shared React stream and human-input helpers internally while preserving Studio's existing JSONL behavior.

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
