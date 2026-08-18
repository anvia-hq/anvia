# @anvia/sandbox

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- eaecb75: Replace stateful sandbox sessions with an explicit Docker client, owned sandbox handles, resumable
  containers, object-only byte-oriented runtime operations, structured opt-in tools, and explicit
  read-only Studio inspector registrations.
- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [9ae0893]
- Updated dependencies [c7f4bbc]
- Updated dependencies [1f6db5c]
- Updated dependencies [5476f98]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/core@1.0.0-rc.2

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

## 0.6.0

### Minor Changes

- 8816b16: Add bounded line pagination to the `read_file` agent tool and Docker sandbox sessions. File reads
  now return continuation metadata and use safe default line and byte limits.

## 0.5.0

### Minor Changes

- 90ff39e: Add `pnpm dlx @anvia/sandbox create-image`, an interactive and scriptable CLI that generates and
  builds local Docker images composed from Node.js, Bun, Python, reporting, Playwright, and curated
  apt, npm, and uv package selections.

## 0.4.1

### Patch Changes

- 24d42ab: Automatically expose sandbox-backed agent workspaces in Studio through read-only APIs and a
  dedicated Sandboxes inspector. Studio servers can also leave SIGINT handling to the application or
  use the managed `serve(...)` lifecycle to await asynchronous resource cleanup.

## 0.4.0

### Minor Changes

- 535c04d: Add loopback-only Docker port publishing, managed long-running processes, readiness checks, and opt-in agent tools for application-proxied website previews.

## 0.3.7

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.

## 0.3.6

### Patch Changes

- 25388db: Publish the widened `@anvia/core` peer dependency range so current 0.x core releases satisfy the sandbox peer requirement.

## 0.3.5

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.4

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.2

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.1

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.0

### Minor Changes

- 18403b7: Add sandbox V2 controls for persistent workspaces, lifecycle cleanup, streaming command execution, file-size limits, observability hooks, language presets, and model-facing tool policies.

## 0.2.2

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.2.0

### Minor Changes

- 74797ba: Add a Docker-backed sandbox package for ephemeral agent workspaces.
