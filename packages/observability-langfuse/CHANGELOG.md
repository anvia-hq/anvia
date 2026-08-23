# @anvia/langfuse

## 1.0.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- 45882ab: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
- a4bf9d2: Bind provider and local-model handles to explicit model IDs, make remote provider factories
  object-only, and introduce honest local loading and ownership boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
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
- 809d3b0: Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
  `generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
  input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
  end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
  inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
  under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
  observers, React, and Studio; and rename audio-generation contracts to speech-generation.
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
  - @anvia/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- 995add8: Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
  `Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
  steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
  `final` event, and migrate Studio, client adapters, and observability integrations to the new API.
- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 475ae22: Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
  interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
  interaction response message parts, linked phase-local runs, suspension-aware nested composition,
  queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
  Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
  and reject unresolved interaction parts at provider boundaries.
- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
- a4bf9d2: Bind provider and local-model handles to explicit model IDs, make remote provider factories
  object-only, and introduce honest local loading and ownership boundaries.
- 3d2fd23: Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
  parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
  protocol. Make Client and Server calls object-only, make React transport-only with standalone
  completion state, and require canonical structural message requests in Studio.
- 809d3b0: Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
  `generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
  input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
  end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
  inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
  under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
  observers, React, and Studio; and rename audio-generation contracts to speech-generation.
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

## 0.6.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.6.0

### Minor Changes

- 36f8324: Add first-party eval CLI result handling, deterministic and abstention metrics, explicit case and
  metric totals, score direction, usage and optional cost aggregation, and negative-control
  assertions. Add optional Lens environment configuration, bundled eval setup, and run-end flushing,
  and migrate observability and Studio consumers to the richer eval result contract. Improve eval
  type safety with readonly suite definitions, metric-aware case requirements, literal-name score
  maps, contravariant reporters, suite-bound custom metrics, and explicit prompt output selectors.

## 0.5.0

### Minor Changes

- 1285e70: Add provider-neutral answer relevancy, G-Eval, prompt alignment, JSON correctness,
  summarization, hallucination, faithfulness, turn relevancy, and knowledge retention metrics.
  Carry trace references through eval reporters, publish eval scores to Langfuse experiments,
  and emit OpenTelemetry `gen_ai.evaluation.result` events correlated with model traces.

## 0.4.0

### Minor Changes

- 693ce2a: Trace complete model inputs and nested agent generations in Langfuse with safe and full capture
  modes, consistent redaction, native prompt and time-to-first-token attributes, and reliable score
  queue flushing. Normalize provider token totals and expose mutually exclusive usage detail buckets
  for accurate cache- and reasoning-aware cost inference.

## 0.3.9

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.3.8

### Patch Changes

- d9ac48c: Expose cumulative authoritative usage on failed agent stream events, include provider-reported usage
  from failed OpenAI Responses requests, and retain failed child-agent usage in built-in observability
  and Studio traces. Agent error event producers must now provide `usage`; unavailable provider usage
  remains empty rather than estimated.

## 0.3.7

### Patch Changes

- 433f642: Simplify optional object construction across runtime integrations without changing public behavior.

## 0.3.6

### Patch Changes

- b52c479: Persist strict JSON message metadata across UI and core message conversions while keeping it out of provider requests and model-generation trace inputs.

## 0.3.5

### Patch Changes

- 8f7ba97: Update upstream runtime dependencies for provider, vector, and observability adapters.

## 0.3.4

### Patch Changes

- 7326e6a: Update upstream runtime dependencies for provider, vector store, observability, and Studio packages.

## 0.3.3

### Patch Changes

- 9fc55c9: Update upstream runtime dependencies to their latest npm releases.

## 0.3.2

### Patch Changes

- 0e33272: Update upstream runtime dependencies to their latest checked releases.

## 0.3.1

### Patch Changes

- 628afa4: Reuse resolved tracing configuration in Langfuse prompt and dataset clients, and standardize examples and docs on `LANGFUSE_TRACING_ENVIRONMENT`.

## 0.3.0

### Minor Changes

- 3de3cce: Add env-var auto-init for tracing config and a `serviceName` option.

  `langfuse.create()` now reads `LANGFUSE_PUBLIC_KEY`,
  `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
  `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, and
  `LANGFUSE_SERVICE_NAME` from the environment when the matching option
  is not provided. Explicit options still win over env vars.

  The new `serviceName` option is recorded on the root observation's
  metadata and set as the OpenTelemetry `service.name` resource
  attribute on the underlying `NodeSDK`.

- 3de3cce: Add Langfuse dataset and experiment-run support.

  `createLangfuseDatasetClient(tracing, options)` exposes four
  methods:

  - `createDataset({ name, description?, metadata? })` PUTs to
    `/api/public/datasets/:name`.
  - `getDataset(name)` GETs `/api/public/datasets/:name` with
    pagination driven by `meta.totalPages`.
  - `upsertItems(name, items)` POSTs the items array to
    `/api/public/datasets/:name/items`.
  - `runExperiment({ datasetName, runName, items?, run })` POSTs
    one batched payload to `/api/public/dataset-run-items` with
    `{ runName, runDescription?, metadata?, datasetItemRuns }`.
    When `items` is not provided the client fetches them from the
    remote dataset first. Per-item failures are collected in
    `errors`; the batch still posts with the successful subset.

  `runEvalAsExperiment(evalOptions, experimentOptions)` runs an
  `@anvia/core/evals` suite and posts a dataset run alongside the
  metric scores, returning both `{ suite, datasetRun }`.

  Auth uses the same `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`
  env vars and base URL as `langfuse.create()`. Per-request
  timeout defaults to 30 seconds (configurable via
  `options.timeoutMs`).

- 3de3cce: Enrich the eval reporter with metadata, dataType propagation,
  truncated input/expected summaries, and a configurable
  `onMissingTrace` mode.

  - Score body now includes `args.metric.metadata`, `dataType`,
    `configId`/`scoreConfigId` from `args.metric`. Categorical and
    boolean outcomes are sent with the correct `value` shape and
    dataType.
  - `case.input` and `case.expected` are JSON-serialized and added as
    `caseInputSummary` / `caseExpectedSummary` in score metadata,
    truncated to `truncateInputAt` bytes (default 2048) with a
    `<truncated>` marker.
  - `output.messages` is included by default; opt out with
    `includeMessages: false`.
  - New `onMissingTrace` option (`"ignore" | "warn" | "throw"`)
    controls reporter behavior when no trace can be resolved. The
    legacy `strict: true` flag is now an alias for `"throw"`.
  - Trace resolution now falls back to `args.case.input.trace` if
    `args.output.trace` is missing.
  - The reporter does not mutate `args.metric.metadata`,
    `args.case.metadata`, or `args.outcome.metadata`.

- 3de3cce: Add PII redaction helpers. `createPiiRedactor` ships with default patterns for emails, credit cards (Luhn-validated), phones, IPv4 addresses, JWTs, and API keys, and supports `redactString`, `redactObject`, and `redactMessages`. Configure tracing with `redactInputs`, `redactOutputs`, and `redaction` to mask text before it leaves the process; `"deep"` recurses into nested values.
- 3de3cce: Add a Langfuse prompt client and prompt-attribute binding on
  traces and generations.

  `createLangfusePromptClient(tracing, options)` exposes four
  methods:

  - `getPrompt(name, { version?, label?, cacheTtlMs?, refresh? })`
    GETs `/api/public/v2/prompts/:name` and returns a parsed
    `LangfusePrompt` (text or chat). Responses are cached in
    memory for `cacheTtlMs` (default 60 s), keyed by
    `name::version::label`.
  - `getPromptText(name, options?)` projects the prompt string.
  - `getPromptChat(name, options?)` projects the chat message
    array.
  - `refresh()` clears the cache.

  The langfuse tracing instance now reads the prompt ref from
  `args.promptRef` (typed) or `args.trace.metadata.promptName` /
  `promptVersion` (string-keyed fallback) on `startRun`, and
  attaches `langfuse.trace.metadata.promptName` /
  `langfuse.trace.metadata.promptVersion` to the root and to each
  generation in the run.

  Auth uses the same `LANGFUSE_PUBLIC_KEY` /
  `LANGFUSE_SECRET_KEY` env vars and base URL as
  `langfuse.create()`. Per-request timeout defaults to 30
  seconds, configurable via `options.timeoutMs`.

- 3de3cce: Add an in-memory score queue with batched sends, exponential-backoff
  retry, and a manual flush method.

  - New `scoreBatchSize`, `scoreFlushIntervalMs` (default 250), and
    `scoreMaxRetries` (default 3) options on `LangfuseTracingOptions`.
    Setting `scoreBatchSize` enables the queue; the default is direct
    send.
  - New `flushScores()` and `scoreQueueDepth()` methods on
    `LangfuseTracing`. `flush()` and `shutdown()` also drain the queue.
  - Retries on 429 and 5xx with exponential backoff (200 ms base,
    2x factor, ±25% jitter, capped at 5 s). Other 4xx throw
    immediately.
  - New `LangfuseScoreError` class. After all retries are exhausted,
    the error's `scores` property contains the failed payloads.
  - New `LangfuseScoreDataType` type export.

- 3de3cce: Forward every streaming delta to Langfuse via
  `generation.update({ output: { delta } })`, so dashboards reflect
  partial output as the model produces it. Supported delta types:
  `text_delta`, `reasoning_delta`, and `tool_call`.
- 3de3cce: Add `LangfuseTraceHandle` and `getCurrentTrace()` to the langfuse
  tracing instance so user code can record event observations and
  attach attributes to the active trace without threading the run
  observer through every function call.

  `LangfuseTracing` now exposes `getCurrentTrace(): LangfuseTraceHandle | undefined`
  and the returned handle has three fields:

  - `traceId` and `observationId` for correlation
  - `addAttributes(attributes)` to set metadata on the root
    observation
  - `addEvent(name, attributes?)` to create a Langfuse `event`
    observation under the root

  The handle is populated when `startRun` is called and cleared when
  the run `end`s or `error`s. The handle is per-tracing-instance and
  last-write-wins; concurrent runs on the same instance will race.

  The langfuse adapter also implements the new `event?(...)` hook
  that was added to `AgentRunObserver` in `@anvia/core`. Calling
  `runObserver.event?.({ name, attributes })` creates a Langfuse
  `event` observation under the active root and ends it immediately.

- 3de3cce: Record extra data on Langfuse observations so the UI shows everything
  the agent runtime emits.

  - Generation observations now carry `providerRequest` and `modelInfo`
    on start, and `firstDeltaMs` on end.
  - Tool observations now carry `toolDefinition` and `toolMetadata` on
    start, and `structuredResult` on end.
  - `usageDetailsFromRecord` now consistently includes
    `cachedInputTokens` and `cacheCreationInputTokens` to match the
    main `usageDetails` helper.

- 3de3cce: Add typed scores and per-score overrides to `tracing.score()`.

  - New `dataType` field (`"NUMERIC" | "CATEGORICAL" | "BOOLEAN"`)
    with boundary validation. `value` is now `number | string` to
    support CATEGORICAL scores.
  - New `configId` (canonical) and `scoreConfigId` (alias) fields for
    Langfuse score configs.
  - New `environment` per-score override.
  - New `timestamp` accepting `Date` or ISO 8601 string.
  - New `timeoutMs` option on `LangfuseTracingOptions` (default 30 s),
    applied via `AbortSignal.timeout` to the score fetch.

## 0.2.8

### Patch Changes

- f8b8538: Refactor package entrypoints into barrel exports with focused internal modules.

## 0.2.7

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.2.6

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.2.5

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.2.4

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.2.3

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

## 0.2.1

### Patch Changes

- 7eb7027: Update upstream wrapper dependencies to the latest available releases.

## 0.2.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

## 0.1.7

### Patch Changes

- b12932d: Update upstream dependencies for PDF loading, globbing, Langfuse tracing, and pgvector support.

  The PDF loader now destroys the `pdfjs-dist` loading task after reading pages, matching the v6 cleanup API.

- Updated dependencies [b12932d]
  - @anvia/core@0.3.1

## 0.1.6

### Patch Changes

- 09c70f5: Add first-class multimodal tool result support.

  Tools can now return `ToolResultContent[]` directly, or use `ToolOutput.content(...)`, and agent execution will pass structured text/image tool results to model turns instead of JSON-stringifying them. Tool middleware, hooks, observers, stream events, and Studio transcript surfaces keep the existing display string while exposing optional structured result content.

  OpenAI Responses and Anthropic now serialize multimodal tool result images as provider-visible image blocks. Text-only provider fallbacks render image results as media-type placeholders instead of raw base64.

  Update provider and tracing wrapper dependencies to the latest checked upstream releases.

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0
