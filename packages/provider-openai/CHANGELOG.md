# @anvia/openai

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

- 32634d6: Add provider-executed tool contracts to the unified tools API, normalize citations and provider
  tool events, and expose Grok live search, code interpreter, collections search, remote MCP, batch
  TTS/STT, Grok 4.5 defaults, and documented image ratio handling.

## 0.3.25

### Patch Changes

- ca24a5e: Emit public tool-call deltas by default for responsive application status, provide an explicit
  legacy opt-out, propagate the setting through streaming agent tools, and handle append-versus-replace
  argument snapshots consistently in React clients.

## 0.3.24

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.

## 0.3.23

### Patch Changes

- 1d8c883: Ensure OpenAI-compatible Chat Completions reasoning chunks retain a stable per-response identity and
  appear before visible answer content.

## 0.3.22

### Patch Changes

- d9ac48c: Expose cumulative authoritative usage on failed agent stream events, include provider-reported usage
  from failed OpenAI Responses requests, and retain failed child-agent usage in built-in observability
  and Studio traces. Agent error event producers must now provide `usage`; unavailable provider usage
  remains empty rather than estimated.

## 0.3.21

### Patch Changes

- 5b0719c: Reject invalid Chat Completions streaming tool indices, isolate the primary completion choice, and fail safely when a streamed tool call ends without valid terminal metadata.

## 0.3.20

### Patch Changes

- 8b7fe0d: Reject malformed JSON tool arguments before execution or persistence while preserving valid scalar and blank inputs.

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
