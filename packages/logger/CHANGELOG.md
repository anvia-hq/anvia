# @anvia/logger

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 4ab25bb: Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
  to agent responses and observer starts, remove the prompt-request API and request subpath, remove
  singular builder registrations, and remove agent event stores in favor of observability integrations.
  Unify direct model calls around input-first completion, image, speech, and transcription functions,
  share retry options across agents and model calls, internalize request builders, and rename the
  pipeline agent stage to `agent()`. Rename `createTool()` schema options from `input` and `output` to
  `inputSchema` and `outputSchema`. Remove `ToolSet`, `AgentBuilder.useToolSet()`, and dynamic/provider
  tool registration methods in favor of a single `tools` option that accepts executable tools,
  provider-native tools, and tool indexes. Move dynamic tool selection settings onto
  `createToolIndex()` and expose each agent's executable inventory through readonly `agent.tools`.
  Unify static documents and searchable context indexes under the `context` option, move retrieval
  settings onto `createContextIndex()`, and expose the declaration inventory through readonly
  `agent.context`. Replace controlling hooks on `new Agent()` with observational `lifecycle`
  callbacks, rename tool approval configuration to `requiresApproval`, and add resumable
  `approval_required` results and stream events through `agent.resume()`. Remove `AgentBuilder`, its
  legacy approval handlers, and the controlling hooks entrypoint; Studio keeps its question workflow
  through an internal runtime hook while bridging resumable approvals to its existing routes and events.
  Replace `PipelineBuilder` and its `build()` phase with an immutable, directly executable
  `new Pipeline({ id, inputSchema })` API while preserving typed fluent composition and graph
  inspection.
  Replace `ExtractorBuilder` with a focused `new Extractor({ model, outputSchema })` API that accepts
  text directly, uses call-level generation and retry options, and returns either parsed data or a
  detailed extraction result without exposing Agent, context, history, or builder configuration.
  Internalize the eval suite's metric factory type and consolidate direct completion and Agent request
  normalization behind one internal request factory, removing the final Core builder abstractions.
- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0

## 0.3.11

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.

## 0.3.10

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.9

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.8

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.7

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.6

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.3.5

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.3.4

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

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

## 0.2.0

### Minor Changes

- c55f5cd: Add the first `@anvia/logger` release with structured logger types, console and Pino logger factories, and an agent observer that logs Anvia run, generation, and tool lifecycle events.

## 0.1.0

### Minor Changes

- Initial release with structured logger types, console and Pino logger factories, and an agent observer that logs Anvia run, generation, and tool lifecycle events.
