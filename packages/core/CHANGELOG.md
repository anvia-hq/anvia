# @anvia/core

## 1.0.9

### Patch Changes

- 68953da: Add typed completion model controls with provider-neutral reasoning effort support, Agent defaults,
  per-run overrides, Studio selectors and persistence, and normalized observability attributes.

## 1.0.8

### Patch Changes

- 18344a2: Improve evaluation developer experience with structural exact matching, explicit target status,
  structured invalid errors, per-case timing/usage/cost diagnostics, typed case requirements and CI
  expectations, safe result formatting, progress events, timeouts, abort signals, independent target
  and metric concurrency, filtering, sharding, fail-fast execution, and rerun case selection.

## 1.0.7

### Patch Changes

- 9e5e068: Preserve canonical memory messages during compaction and store the latest summary as a separate
  model-context checkpoint. Memory loads and inspection now remain fully replayable, while compacted
  model requests receive the summary plus only the unsummarized tail.

## 1.0.6

### Patch Changes

- 32cffc0: Remove local PDF text extraction and the optional `pdfjs-dist` dependency from Core. PDF attachment
  contracts remain available for provider adapters, while applications retain ownership of document
  parsing before using Core text chunking.

## 1.0.5

### Patch Changes

- c7fb0f8: Declare and verify Bun 1.3.14 runtime compatibility for the built packages, public Core exports,
  Client and Server streaming, OpenAI SDK transport and media paths, and MCP HTTP/SSE and stdio
  transports. Make structured tool output branding stable across multiple Core module instances.

## 1.0.4

### Patch Changes

- 7973ddc: Add constructor-level named Pipeline observability with run and stage lifecycles, primary trace
  results, and automatic parent propagation into Agent stages. Add OpenTelemetry and Lens Pipeline
  observers that export nested spans for composed, parallel, Agent, extraction, and custom stages.

## 1.0.3

### Patch Changes

- 3113e9a: Add matching raw-text ingestion helpers for vector stores and managed knowledge graphs, including
  shared deterministic chunking and reusable graph/vector embeddings.

## 1.0.2

### Patch Changes

- c7c45a9: Report cancelled Agent runs explicitly and gracefully drain active Studio runs before observability
  providers shut down on SIGINT or SIGTERM.

## 1.0.1

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

- 9ae0893: Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
  adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
  typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
  message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
  endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
  the same explicit boundary. Preserve provider tool identity, final sources, reasoning, transformed
  data, application metadata, and resumable stream identity across that boundary.
- 07a1e6c: Move MCP clients, transports, tool discovery, result mapping, and URL safety into the dedicated
  `@anvia/mcp` package. Core keeps only the lightweight MCP registration contracts consumed by Agent;
  applications now import `McpClient` and `McpClientGroup` from `@anvia/mcp`.
- 0292ede: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- 007b132: Apply LanceDB metadata filters through Core's provider-neutral matcher instead of generating SQL
  against the adapter's serialized metadata column. This fixes filtering with LanceDB 0.37, prevents
  filter keys or values from becoming SQL, and removes the unsupported `filterToLanceExpr` export.
- c0c6cb8: Install workspace dependencies in the OIDC publish job before packing the synchronized release train.
- a90416c: Classify malformed provider tool arguments as typed retryable output failures, validate all tool
  calls before execution, preserve failed-attempt usage without exposing raw arguments, and reject
  truncated, filtered, incomplete, ambiguous, or non-JSON tool-call responses across first-party
  providers. Reject blank tool arguments and non-JSON provider options instead of inventing or
  coercing values. Align `JsonObject` with runtime validation by excluding explicit `undefined`
  properties while accepting immutable JSON arrays. Apply the same strict provider-options boundary
  to completion, image, speech, and transcription calls. Require finite strict JSON for eval inputs
  and parsed results instead of coercing them. Keep streaming retries disabled after observable
  provider progress.
  Validate React composer entity data as finite strict JSON at trigger, submission, and message
  rendering boundaries.
  Require MCP tool arguments to be strict JSON objects; only an explicit `undefined` direct call
  omits the remote arguments field.
  Make client tool-part states exact: completed results retain their original input, impossible state
  combinations are rejected, and partial streamed arguments can never be replayed as model input.
- 1dfb4f3: Preserve normalized and provider-native completion finish reasons across first-party adapters,
  identify output-limit truncation before structured parsing, rebuild Agent repairs from the original
  request with omitted or bounded text-only output, and log safe per-attempt retry diagnostics through
  named observer events.
- 07a1e6c: Make `pdfjs-dist` an optional peer dependency so applications that do not use PDF text extraction
  avoid installing PDF.js and its native canvas dependency. Applications using `extractPdfText` must
  install `pdfjs-dist` directly.
- 8dc2dfb: Publish the synchronized Anvia package train through npm Trusted Publishing with GitHub OIDC and
  provenance instead of a long-lived npm access token.
- 6354116: Prepare the synchronized Anvia 1.0 package train for its first public release candidate.
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
- 9cb661c: Replace the stateful filesystem and PDF loader API with explicit in-memory `chunkText` strategies
  and abortable `extractPdfText` parsing under `@anvia/core/documents`. Applications now own file
  discovery, reads, source metadata, document mapping, and error policy.
- 1f6db5c: Replace MCP connection factories with lifecycle-owning `McpClient` and `McpClientGroup` classes,
  immutable Agent `mcpServers` registrations, typed tool provenance, fixed paginated discovery, and
  explicit transport and result boundaries. Studio now consumes Agent registrations directly.
- 5ec61e3: Allow applications to explicitly disable Streamable HTTP SSRF protection for trusted local or
  private-network MCP servers while retaining strict public-only validation by default. Replace the
  arbitrary `requestInit` escape hatch with strictly validated string `headers` scoped to the exact MCP
  endpoint while keeping protocol-owned request fields and OAuth traffic isolated.
- 5476f98: Redesign durable memory adapter construction, provisioning, validation, scope keys, and native
  connection ownership around explicit application lifecycle boundaries.
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
- 0292ede: Accept only complete outer JSON Markdown fences as a strict structured-output compatibility
  fallback, retry Agent parsing and schema failures within the configured total-attempt budget, and
  surface phase-aware errors without embedding rejected output. Preserve nested Error cause details
  in logger observer records with bounded traversal and redact parser/schema causes that may contain
  rejected structured output.
- 809d3b0: Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
  `generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
  input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
  end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
  inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
  under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
  observers, React, and Studio; and rename audio-generation contracts to speech-generation.
- b363c93: Update upstream runtime dependencies and preserve compatibility with the latest Anthropic SDKs.

## 1.0.0-rc.11

### Patch Changes

- 995add8: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- 9e6df68: Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
  Add a customizable token counter, token counts to compaction results and stream events, and
  `Agent.compactMemory()` for explicit manual compaction.

## 1.0.0-rc.10

### Patch Changes

- ef7ad39: Move MCP clients, transports, tool discovery, result mapping, and URL safety into the dedicated
  `@anvia/mcp` package. Core keeps only the lightweight MCP registration contracts consumed by Agent;
  applications now import `McpClient` and `McpClientGroup` from `@anvia/mcp`.
- 9b9fe04: Make `pdfjs-dist` an optional peer dependency so applications that do not use PDF text extraction
  avoid installing PDF.js and its native canvas dependency. Applications using `extractPdfText` must
  install `pdfjs-dist` directly.

## 1.0.0-rc.9

### Patch Changes

- c0c6cb8: Install workspace dependencies in the OIDC publish job before packing the synchronized release train.

## 1.0.0-rc.8

### Patch Changes

- 8dc2dfb: Publish the synchronized Anvia package train through npm Trusted Publishing with GitHub OIDC and
  provenance instead of a long-lived npm access token.

## 1.0.0-rc.7

### Patch Changes

- 6341fd8: Classify malformed provider tool arguments as typed retryable output failures, validate all tool
  calls before execution, preserve failed-attempt usage without exposing raw arguments, and reject
  truncated, filtered, incomplete, ambiguous, or non-JSON tool-call responses across first-party
  providers. Reject blank tool arguments and non-JSON provider options instead of inventing or
  coercing values. Align `JsonObject` with runtime validation by excluding explicit `undefined`
  properties while accepting immutable JSON arrays. Apply the same strict provider-options boundary
  to completion, image, speech, and transcription calls. Require finite strict JSON for eval inputs
  and parsed results instead of coercing them. Keep streaming retries disabled after observable
  provider progress.
  Validate React composer entity data as finite strict JSON at trigger, submission, and message
  rendering boundaries.
  Require MCP tool arguments to be strict JSON objects; only an explicit `undefined` direct call
  omits the remote arguments field.
  Make client tool-part states exact: completed results retain their original input, impossible state
  combinations are rejected, and partial streamed arguments can never be replayed as model input.

## 1.0.0-rc.6

### Patch Changes

- 706b321: Preserve normalized and provider-native completion finish reasons across first-party adapters,
  identify output-limit truncation before structured parsing, rebuild Agent repairs from the original
  request with omitted or bounded text-only output, and log safe per-attempt retry diagnostics through
  named observer events.

## 1.0.0-rc.5

### Patch Changes

- e96d038: Move Agent interaction contracts and parsers to the browser-safe
  `@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
  runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
- e96d038: Accept only complete outer JSON Markdown fences as a strict structured-output compatibility
  fallback, retry Agent parsing and schema failures within the configured total-attempt budget, and
  surface phase-aware errors without embedding rejected output. Preserve nested Error cause details
  in logger observer records with bounded traversal and redact parser/schema causes that may contain
  rejected structured output.

## 1.0.0-rc.4

### Patch Changes

- 007b132: Apply LanceDB metadata filters through Core's provider-neutral matcher instead of generating SQL
  against the adapter's serialized metadata column. This fixes filtering with LanceDB 0.37, prevents
  filter keys or values from becoming SQL, and removes the unsupported `filterToLanceExpr` export.

## 1.0.0-rc.3

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- 9cb661c: Replace the stateful filesystem and PDF loader API with explicit in-memory `chunkText` strategies
  and abortable `extractPdfText` parsing under `@anvia/core/documents`. Applications now own file
  discovery, reads, source metadata, document mapping, and error policy.
- 5ec61e3: Allow applications to explicitly disable Streamable HTTP SSRF protection for trusted local or
  private-network MCP servers while retaining strict public-only validation by default. Replace the
  arbitrary `requestInit` escape hatch with strictly validated string `headers` scoped to the exact MCP
  endpoint while keeping protocol-owned request fields and OAuth traffic isolated.

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
- 5476f98: Redesign durable memory adapter construction, provisioning, validation, scope keys, and native
  connection ownership around explicit application lifecycle boundaries.
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

## 1.0.0-rc.1

### Patch Changes

- Prepare the synchronized Anvia 1.0 package train for its first public release candidate.

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

## 0.26.0

### Minor Changes

- 461a04d: Harden MCP HTTP and SSE connections against SSRF by validating and pinning DNS results for every
  outbound origin, including redirects and OAuth metadata endpoints. Custom transport fetch
  implementations are rejected so they cannot bypass these protections.

## 0.25.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.25.0

### Minor Changes

- 36f8324: Add first-party eval CLI result handling, deterministic and abstention metrics, explicit case and
  metric totals, score direction, usage and optional cost aggregation, and negative-control
  assertions. Add optional Lens environment configuration, bundled eval setup, and run-end flushing,
  and migrate observability and Studio consumers to the richer eval result contract. Improve eval
  type safety with readonly suite definitions, metric-aware case requirements, literal-name score
  maps, contravariant reporters, suite-bound custom metrics, and explicit prompt output selectors.

## 0.24.0

### Minor Changes

- e55a792: Add first-class evaluation run identity and lifecycle reporting so Anvia Lens can group completed
  suites, compare releases, and apply quality gates.

## 0.23.0

### Minor Changes

- 1285e70: Add provider-neutral answer relevancy, G-Eval, prompt alignment, JSON correctness,
  summarization, hallucination, faithfulness, turn relevancy, and knowledge retention metrics.
  Carry trace references through eval reporters, publish eval scores to Langfuse experiments,
  and emit OpenTelemetry `gen_ai.evaluation.result` events correlated with model traces.

## 0.22.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

## 0.21.0

### Minor Changes

- 1ff8304: Add first-class stream resume to the shared request and response APIs.

  `UIStreamRequest` now includes optional `resume: { streamId, after }`. `@anvia/server` adds a
  `createEventStream({ resume })` / `createUIStreamResponse({ resume })` overload so routes can
  continue in-flight streams without manually composing `resumeStreamEvents`.

## 0.20.0

### Minor Changes

- f7eef6c: Add sparse embedding contracts and Qdrant hybrid RRF search.

  Core gains `SparseVector` / `SparseEmbeddingModel`, plus `embedSparseTexts`, `embedSparseQuery`,
  and `embedHybridDocuments`. `@anvia/fastembed` wraps FastEmbed SPLADE++. `@anvia/qdrant` supports
  named dense+sparse collections and fused hybrid search via the same `index(...).search(...)` path.

## 0.19.0

### Minor Changes

- d570f84: **Breaking:** Remove deprecated middleware and hook aliases.

  Use `createMiddleware`, `AgentMiddleware`, `.middleware(...)` / `.middlewares(...)`, `.withMiddleware(...)` / `.withMiddlewares(...)`, `.withHook(...)`, and `onToolOutput` instead of `createToolMiddleware`, `ToolMiddleware`, `.toolMiddleware(...)` / `.toolMiddlewares(...)`, `.withToolMiddleware(...)` / `.withToolMiddlewares(...)`, `.requestHook(...)`, and `onResult`.

## 0.18.0

### Minor Changes

- eff30fb: Add opt-in, model-generated durable memory compaction with atomic conflict detection, official
  database-adapter support, aggregate usage accounting, and React hydration that hides synthetic
  summary messages by default.

## 0.17.0

### Minor Changes

- 693ce2a: Trace complete model inputs and nested agent generations in Langfuse with safe and full capture
  modes, consistent redaction, native prompt and time-to-first-token attributes, and reliable score
  queue flushing. Normalize provider token totals and expose mutually exclusive usage detail buckets
  for accurate cache- and reasoning-aware cost inference.

## 0.16.0

### Minor Changes

- 32634d6: Add provider-executed tool contracts to the unified tools API, normalize citations and provider
  tool events, and expose Grok live search, code interpreter, collections search, remote MCP, batch
  TTS/STT, Grok 4.5 defaults, and documented image ratio handling.

## 0.15.0

### Minor Changes

- ca24a5e: Emit public tool-call deltas by default for responsive application status, provide an explicit
  legacy opt-out, propagate the setting through streaming agent tools, and handle append-versus-replace
  argument snapshots consistently in React clients.

## 0.14.0

### Minor Changes

- d9ac48c: Expose cumulative authoritative usage on failed agent stream events, include provider-reported usage
  from failed OpenAI Responses requests, and retain failed child-agent usage in built-in observability
  and Studio traces. Agent error event producers must now provide `usage`; unavailable provider usage
  remains empty rather than estimated.

## 0.13.5

### Patch Changes

- 9e190bc: Persist provider, model, and per-generation token usage on generated assistant messages, and show
  those durable response metrics in Studio's Memory inspector.
- ede828b: Add optional read-only memory inspection, implement it across the database memory adapters, and let
  Studio discover persisted agent conversations before falling back to Studio session storage.

## 0.13.4

### Patch Changes

- d196025: Add prompt-scoped completion retries for transient non-streaming and pre-output streaming failures.

## 0.13.3

### Patch Changes

- 8b7fe0d: Reject malformed JSON tool arguments before execution or persistence while preserving valid scalar and blank inputs.

## 0.13.2

### Patch Changes

- b5f285a: Preserve streamed tool call names and provider call IDs when continuation chunks contain empty metadata placeholders.

## 0.13.1

### Patch Changes

- 433f642: Simplify internal optional-property construction while preserving the existing public API and runtime behavior.

## 0.13.0

### Minor Changes

- b52c479: Persist strict JSON message metadata across UI and core message conversions while keeping it out of provider requests and model-generation trace inputs.

## 0.12.8

### Patch Changes

- 26efea0: Match persisted tool results by unique call ID before reused provider IDs and store tool names on new results.

## 0.12.7

### Patch Changes

- b54fba5: Scope live UI tool result matching by turn when reducer events include turn metadata.

## 0.12.6

### Patch Changes

- 70ae42c: Preserve streamed and replayed tool result ordering across text/tool boundaries.

## 0.12.5

### Patch Changes

- 384c8f0: Preserve tool result names when rehydrating persisted UI messages from core messages.

## 0.12.4

### Patch Changes

- 327261f: Preserve streamed assistant content part order when reconstructing final streaming responses.

## 0.12.3

### Patch Changes

- 6cd352e: Fix agent option isolation, deterministic regex eval metrics, and MCP client version metadata.

## 0.12.2

### Patch Changes

- 7b398eb: Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
  Merge raw agent tool-call results back into the originating tool part when provider and internal call ids differ.
  Add UI attachment contracts, chat suggestions, composer attachments, auto-resizing composer input, Markdown rendering, granular tool primitives, thread status helpers, expanded human-input controls, controlled composer state, custom composer submit handlers, optional empty collection mounting, and thinner headless defaults.

## 0.12.1

### Patch Changes

- 2735197: Remove experimental tool and tool-result guardrails. Guardrail policies now cover input and final output boundaries only; use tool approvals, hooks, middleware, and service-level validation for tool execution behavior.

## 0.12.0

### Minor Changes

- eed8b5f: Add experimental guardrail policies for input, tool calls, tool results, and final output.

## 0.11.3

### Patch Changes

- 32171dc: Add provider model-name types for autocomplete while preserving custom string model IDs.

## 0.11.2

### Patch Changes

- 730c23d: Clean up request internals by moving prompt runtime implementation details behind the internal source boundary while preserving the public request API.

## 0.11.1

### Patch Changes

- 9fc55c9: Update upstream runtime dependencies to their latest npm releases.

## 0.11.0

### Minor Changes

- 4068a2a: Send converted core messages from React hooks and keep completion helpers limited to core `Message` input.

## 0.10.0

### Minor Changes

- 9e4de00: Improve completion stream DX by allowing `createCompletionStream()` and `createCompletion()` to accept UI messages directly, and by letting React hooks consume raw completion or agent stream events without a separate UI stream adapter.

## 0.9.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

## 0.8.0

### Minor Changes

- 3de3cce: Add an optional `update?` hook on `AgentGenerationObserver` so
  observability adapters can record streaming deltas as they arrive.

  The agent loop now awaits `observer.update?.({ turn, delta })` for
  every delta produced by the underlying completion stream. The new
  method is optional, so existing adapters keep working. A new
  `AgentGenerationUpdateArgs` type is exported alongside.

- 3de3cce: Add an optional `event?` hook on `AgentRunObserver` so
  observability adapters can record ad-hoc checkpoints (e.g.
  retrieval, validation) during a run.

  The new method accepts an `AgentRunEventArgs` value with a `name`,
  optional `attributes` map, optional `level`, and optional
  `timestamp`. The hook is optional, so existing adapters keep
  working without modification.

- 3de3cce: Add an optional `promptRef?: { name; version? }` field on
  `AgentRunStartArgs`. Observability adapters can use this to
  record the prompt name and version on the trace root and on
  each generation in the run.

  The new field is optional, so existing call sites keep
  compiling. The `AgentRunPromptRef` type is also exported
  alongside.

- 3de3cce: Extend the `EvalMetric` type with optional Langfuse-related
  annotations: `dataType`, `scoreConfigId`, `configId`, and
  `metadata`. All fields are optional, so existing metric definitions
  keep compiling unchanged.

  Add a `defineMetric()` identity helper that wraps a metric
  definition for clearer intent at call sites. Re-export it from
  `@anvia/core/evals`.

## 0.7.1

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.

## 0.7.0

### Minor Changes

- ef5e727: Add centralized tool approval handling with tool-level approval policies and `.approvals(...)` decision handlers.

  Add React `useChat` human-input state for tool approvals and `ask_question` prompts, including helpers for approving, rejecting, and answering pending human input.

## 0.6.3

### Patch Changes

- 369b6c4: Refactor internal code quality: consolidate duplicate utilities, eliminate conditional spread patterns, and improve file organization.

## 0.6.2

### Patch Changes

- 4806f3e: Add `PromptRequest.steer()` for enqueueing user messages at safe model-turn boundaries during active prompt runs.

## 0.6.1

### Patch Changes

- 2d039f6: Add ergonomic tool result message helpers and export `ToolContent` from the root entrypoint.

## 0.6.0

### Minor Changes

- e54aece: Add direct completion helpers for non-streaming, streaming, and parsed structured output flows.

  `createCompletion` now always returns a final completion result, `createCompletionStream` exposes raw normalized model stream events, and `createParsedCompletion` returns schema-validated data from direct completions.

## 0.5.0

### Minor Changes

- 4ab66c9: Broaden agent runtime hooks and add general middleware for completion requests, completion responses, tool inputs, and tool outputs while keeping existing tool middleware APIs as deprecated aliases.

## 0.4.2

### Patch Changes

- 4c1620d: Harden MCP connection cleanup and vector dimension validation, and organize loader internals without changing public loader APIs.

## 0.4.1

### Patch Changes

- 95712d8: Refactor core internals for improved maintainability while preserving public API and behavior.

## 0.4.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.3.1

### Patch Changes

- b12932d: Update upstream dependencies for PDF loading, globbing, Langfuse tracing, and pgvector support.

  The PDF loader now destroys the `pdfjs-dist` loading task after reading pages, matching the v6 cleanup API.

## 0.3.0

### Minor Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

## 0.2.4

### Patch Changes

- a0a5def: Preserve accumulated streamed tool arguments when a provider final response contains an empty tool input.
