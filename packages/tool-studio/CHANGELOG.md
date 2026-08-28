# @anvia/studio

## 1.0.7

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/client@1.0.5
  - @anvia/core@1.0.5
  - @anvia/server@1.0.5
  - @anvia/react@1.0.5
  - @anvia/react-ui@1.0.5
  - @anvia/graph@1.0.6

## 1.0.6

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4
  - @anvia/client@1.0.4
  - @anvia/graph@1.0.5
  - @anvia/react@1.0.4
  - @anvia/react-ui@1.0.4
  - @anvia/server@1.0.4

## 1.0.5

### Patch Changes

- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3
  - @anvia/graph@1.0.4
  - @anvia/client@1.0.3
  - @anvia/react@1.0.3
  - @anvia/react-ui@1.0.3
  - @anvia/server@1.0.3

## 1.0.4

### Patch Changes

- 5ca833e: Add provider-neutral knowledge graph primitives, a schema-first Memgraph GraphRAG adapter, and
  graph-bound retrieval for portable Neo4j and Memgraph applications. Standardize Agent integration
  on the shared `createGraphSearchTool()` factory with evidence-aware typing. Add bounded graph
  exploration to both adapters and a searchable, expandable graph explorer in Studio.
- Updated dependencies [5ca833e]
  - @anvia/graph@1.0.3

## 1.0.3

### Patch Changes

- 25bc1bf: Align Studio colors, interaction states, surfaces, syntax highlighting, and dark-first theme behavior
  with the Anvia web design system.
- c77a7a2: Align trace payload inspection with Lens using independent readable, structured, raw, and metadata
  table views, including structured tool-call disclosures.

## 1.0.2

### Patch Changes

- c7c45a9: Report cancelled Agent runs explicitly and gracefully drain active Studio runs before observability
  providers shut down on SIGINT or SIGTERM.
- Updated dependencies [c7c45a9]
  - @anvia/core@1.0.2
  - @anvia/client@1.0.2
  - @anvia/react@1.0.2
  - @anvia/react-ui@1.0.2
  - @anvia/server@1.0.2

## 1.0.1

### Patch Changes

- f29f2f6: Refresh upstream SDK and runtime dependencies to their latest supported releases.
- Updated dependencies [f29f2f6]
  - @anvia/react-ui@1.0.1
  - @anvia/client@1.0.1
  - @anvia/core@1.0.1
  - @anvia/react@1.0.1
  - @anvia/server@1.0.1

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Minor Changes

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

### Patch Changes

- 07a1e6c: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.
- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 0292ede: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- c7f4bbc: Move durable memory selection onto the object-only Agent generate and stream boundaries, remove
  AgentSession and positional execution signatures, and distinguish stateful prompts from stateless
  transcripts. Replace implicit compaction summaries with explicit MemoryScope, store capability,
  typed compaction-message, result metadata, and stream-event contracts. Persist compaction messages
  atomically in every memory adapter and carry compaction events through Client, React, resumable
  server streams, and Studio logs without creating synthetic chat messages.
- 45882ab: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- eaecb75: Replace stateful sandbox sessions with an explicit Docker client, owned sandbox handles, resumable
  containers, object-only byte-oriented runtime operations, structured opt-in tools, and explicit
  read-only Studio inspector registrations.
- 1f6db5c: Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
  immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
  explicit transport and result boundaries. Studio now consumes Agent registrations directly.
- 45882ab: Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
  Add a customizable token counter, token counts to compaction results and stream events, and
  `Agent.compactMemory()` for explicit manual compaction.
- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
- 593c725: Replace the stateful Extractor class with object-only tool-based extraction and detailed completion
  results. Redesign Pipeline stages and execution around stable stage IDs, explicit input mappers,
  named run results, settled batches, abort propagation, and hierarchical graph and event paths.
- a4bf9d2: Bind provider and local-model handles to explicit model IDs, make remote provider factories
  object-only, and introduce honest local loading and ownership boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- 927f81b: Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
  raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
  and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
  lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
  retries. Normalize provider scores so larger values are consistently better, return `topK` logical
  documents even when documents have multiple chunks, and require explicit Redis metadata indexing
  for filtered search.
- 809d3b0: Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
  `generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
  input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
  end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
  inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
  under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
  observers, React, and Studio; and rename audio-generation contracts to speech-generation.
- b363c93: Update upstream runtime dependencies and preserve compatibility with the latest Anthropic SDKs.
- Updated dependencies [07a1e6c]
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [07a1e6c]
- Updated dependencies [0292ede]
- Updated dependencies [007b132]
- Updated dependencies [c0c6cb8]
- Updated dependencies [a90416c]
- Updated dependencies [1dfb4f3]
- Updated dependencies [07a1e6c]
- Updated dependencies [8dc2dfb]
- Updated dependencies [6354116]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [9cb661c]
- Updated dependencies [1f6db5c]
- Updated dependencies [5ec61e3]
- Updated dependencies [5476f98]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [0292ede]
- Updated dependencies [4ab25bb]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/react-ui@1.0.0
  - @anvia/core@1.0.0
  - @anvia/react@1.0.0
  - @anvia/server@1.0.0
  - @anvia/client@1.0.0

## 1.0.0-rc.11

### Patch Changes

- 995add8: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- 9e6df68: Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
  Add a customizable token counter, token counts to compaction results and stream events, and
  `Agent.compactMemory()` for explicit manual compaction.
- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11
  - @anvia/client@1.0.0-rc.11
  - @anvia/react@1.0.0-rc.11
  - @anvia/react-ui@1.0.0-rc.11
  - @anvia/server@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- 928315b: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.
- Updated dependencies [928315b]
- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/react-ui@1.0.0-rc.10
  - @anvia/core@1.0.0-rc.10
  - @anvia/client@1.0.0-rc.10
  - @anvia/react@1.0.0-rc.10
  - @anvia/server@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9
  - @anvia/client@1.0.0-rc.9
  - @anvia/react@1.0.0-rc.9
  - @anvia/react-ui@1.0.0-rc.9
  - @anvia/server@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8
  - @anvia/client@1.0.0-rc.8
  - @anvia/react@1.0.0-rc.8
  - @anvia/react-ui@1.0.0-rc.8
  - @anvia/server@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7
  - @anvia/client@1.0.0-rc.7
  - @anvia/react-ui@1.0.0-rc.7
  - @anvia/react@1.0.0-rc.7
  - @anvia/server@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6
  - @anvia/client@1.0.0-rc.6
  - @anvia/react@1.0.0-rc.6
  - @anvia/react-ui@1.0.0-rc.6
  - @anvia/server@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- e96d038: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5
  - @anvia/client@1.0.0-rc.5
  - @anvia/react@1.0.0-rc.5
  - @anvia/react-ui@1.0.0-rc.5
  - @anvia/server@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4
  - @anvia/client@1.0.0-rc.4
  - @anvia/react@1.0.0-rc.4
  - @anvia/react-ui@1.0.0-rc.4
  - @anvia/server@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- eaecb75: Replace stateful sandbox sessions with an explicit Docker client, owned sandbox handles, resumable
  containers, object-only byte-oriented runtime operations, structured opt-in tools, and explicit
  read-only Studio inspector registrations.
- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3
  - @anvia/client@1.0.0-rc.3
  - @anvia/server@1.0.0-rc.3
  - @anvia/react@1.0.0-rc.3
  - @anvia/react-ui@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- c7f4bbc: Move durable memory selection onto the object-only Agent generate and stream boundaries, remove
  AgentSession and positional execution signatures, and distinguish stateful prompts from stateless
  transcripts. Replace implicit compaction summaries with explicit MemoryScope, store capability,
  typed compaction-message, result metadata, and stream-event contracts. Persist compaction messages
  atomically in every memory adapter and carry compaction events through Client, React, resumable
  server streams, and Studio logs without creating synthetic chat messages.
- 1f6db5c: Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
  immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
  explicit transport and result boundaries. Studio now consumes Agent registrations directly.
- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
- 593c725: Replace the stateful Extractor class with object-only tool-based extraction and detailed completion
  results. Redesign Pipeline stages and execution around stable stage IDs, explicit input mappers,
  named run results, settled batches, abort propagation, and hierarchical graph and event paths.
- a4bf9d2: Bind provider and local-model handles to explicit model IDs, make remote provider factories
  object-only, and introduce honest local loading and ownership boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- 927f81b: Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
  raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
  and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
  lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
  retries. Normalize provider scores so larger values are consistently better, return `topK` logical
  documents even when documents have multiple chunks, and require explicit Redis metadata indexing
  for filtered search.
- 809d3b0: Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
  `generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
  input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
  end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
  inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
  under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
  observers, React, and Studio; and rename audio-generation contracts to speech-generation.
- b363c93: Update upstream runtime dependencies and preserve compatibility with the latest Anthropic SDKs.
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
  - @anvia/client@1.0.0-rc.2
  - @anvia/core@1.0.0-rc.2
  - @anvia/server@1.0.0-rc.2
  - @anvia/react@1.0.0-rc.2
  - @anvia/react-ui@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1
  - @anvia/react@1.0.0-rc.1
  - @anvia/server@1.0.0-rc.1
  - @anvia/react-ui@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Minor Changes

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

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0
  - @anvia/react@1.0.0-rc.0
  - @anvia/react-ui@1.0.0-rc.0
  - @anvia/server@1.0.0-rc.0

## 0.8.1

### Patch Changes

- 0b8c4bb: Use the consumer's `@anvia/core` installation from React and Server so Studio targets do not
  resolve incompatible Agent and Pipeline class declarations from nested Core versions.
- Updated dependencies [0b8c4bb]
  - @anvia/react@0.11.6
  - @anvia/server@0.7.6
  - @anvia/react-ui@0.7.1

## 0.8.0

### Minor Changes

- 6f3bb2e: Align Studio's tokens, typography, trace details, Phosphor icons, theme behavior, components, and application shell with Anvia Lens, and remove the Evals UI.

## 0.7.54

### Patch Changes

- @anvia/react@0.11.5
- @anvia/server@0.7.5
- @anvia/react-ui@0.7.1

## 0.7.53

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.
- Updated dependencies [615b767]
  - @anvia/react-ui@0.7.1
  - @anvia/react@0.11.4
  - @anvia/server@0.7.4

## 0.7.52

### Patch Changes

- 36f8324: Add first-party eval CLI result handling, deterministic and abstention metrics, explicit case and
  metric totals, score direction, usage and optional cost aggregation, and negative-control
  assertions. Add optional Lens environment configuration, bundled eval setup, and run-end flushing,
  and migrate observability and Studio consumers to the richer eval result contract. Improve eval
  type safety with readonly suite definitions, metric-aware case requirements, literal-name score
  maps, contravariant reporters, suite-bound custom metrics, and explicit prompt output selectors.
  - @anvia/react@0.11.3
  - @anvia/server@0.7.3
  - @anvia/react-ui@0.7.0

## 0.7.51

### Patch Changes

- @anvia/react@0.11.2
- @anvia/server@0.7.2
- @anvia/react-ui@0.7.0

## 0.7.50

### Patch Changes

- @anvia/react@0.11.1
- @anvia/server@0.7.1
- @anvia/react-ui@0.7.0

## 0.7.49

### Patch Changes

- Updated dependencies [cf1dff7]
  - @anvia/react@0.11.0
  - @anvia/react-ui@0.7.0
  - @anvia/server@0.7.0

## 0.7.48

### Patch Changes

- Updated dependencies [1684893]
  - @anvia/react-ui@0.6.3

## 0.7.47

### Patch Changes

- Updated dependencies [1ff8304]
  - @anvia/server@0.6.0
  - @anvia/react@0.10.3
  - @anvia/react-ui@0.6.2

## 0.7.46

### Patch Changes

- @anvia/react@0.10.2
- @anvia/server@0.5.18
- @anvia/react-ui@0.6.2

## 0.7.45

### Patch Changes

- @anvia/react@0.10.1
- @anvia/server@0.5.17
- @anvia/react-ui@0.6.2

## 0.7.44

### Patch Changes

- Updated dependencies [eff30fb]
  - @anvia/react@0.10.0
  - @anvia/server@0.5.16
  - @anvia/react-ui@0.6.2

## 0.7.43

### Patch Changes

- @anvia/react@0.9.4
- @anvia/server@0.5.15
- @anvia/react-ui@0.6.2

## 0.7.42

### Patch Changes

- @anvia/react@0.9.3
- @anvia/server@0.5.14
- @anvia/react-ui@0.6.2

## 0.7.41

### Patch Changes

- 7f4ce71: Update upstream runtime patch dependencies for React UI and Studio packages.
- Updated dependencies [7f4ce71]
  - @anvia/react-ui@0.6.2

## 0.7.40

### Patch Changes

- Updated dependencies [ca24a5e]
  - @anvia/react@0.9.2
  - @anvia/server@0.5.13
  - @anvia/react-ui@0.6.1

## 0.7.39

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.
- Updated dependencies [2ae2087]
  - @anvia/react-ui@0.6.1

## 0.7.38

### Patch Changes

- d9ac48c: Expose cumulative authoritative usage on failed agent stream events, include provider-reported usage
  from failed OpenAI Responses requests, and retain failed child-agent usage in built-in observability
  and Studio traces. Agent error event producers must now provide `usage`; unavailable provider usage
  remains empty rather than estimated.
  - @anvia/react@0.9.1
  - @anvia/server@0.5.12
  - @anvia/react-ui@0.6.0

## 0.7.37

### Patch Changes

- 129f37c: Replace stream animation presets with lifecycle-driven, buffered smoothing for text and ordered
  mixed items. Add stable-block live Markdown rendering and use the pipeline in the Studio Playground
  transcript.
- Updated dependencies [129f37c]
  - @anvia/react@0.9.0
  - @anvia/react-ui@0.6.0

## 0.7.36

### Patch Changes

- 9005667: Automatically retry transient completion failures for buffered and pre-output streaming agent runs.

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
