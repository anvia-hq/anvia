# @anvia/grok

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5
  - @anvia/openai@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4
  - @anvia/openai@1.0.0-rc.4

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
  - @anvia/openai@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

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
  - @anvia/openai@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1
  - @anvia/openai@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0
  - @anvia/openai@1.0.0-rc.0

## 0.4.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.
- Updated dependencies [615b767]
  - @anvia/openai@0.5.1

## 0.4.0

### Minor Changes

- cf1dff7: Add model-aware context limits and provider-reported active context usage to completion responses,
  agent results, streams, persisted generation metadata, memory-backed agent sessions, React hooks,
  server UI streams, and a React context meter primitive.

### Patch Changes

- Updated dependencies [cf1dff7]
  - @anvia/openai@0.5.0

## 0.3.1

### Patch Changes

- 693ce2a: Trace complete model inputs and nested agent generations in Langfuse with safe and full capture
  modes, consistent redaction, native prompt and time-to-first-token attributes, and reliable score
  queue flushing. Normalize provider token totals and expose mutually exclusive usage detail buckets
  for accurate cache- and reasoning-aware cost inference.
- Updated dependencies [693ce2a]
  - @anvia/openai@0.4.1

## 0.3.0

### Minor Changes

- 32634d6: Add provider-executed tool contracts to the unified tools API, normalize citations and provider
  tool events, and expose Grok live search, code interpreter, collections search, remote MCP, batch
  TTS/STT, Grok 4.5 defaults, and documented image ratio handling.

### Patch Changes

- Updated dependencies [32634d6]
  - @anvia/openai@0.4.0

## 0.2.11

### Patch Changes

- Updated dependencies [ca24a5e]
  - @anvia/openai@0.3.25

## 0.2.10

### Patch Changes

- 2ae2087: Update upstream runtime dependencies for provider, vector store, observability, React UI,
  and Studio packages.
- Updated dependencies [2ae2087]
  - @anvia/openai@0.3.24

## 0.2.9

### Patch Changes

- Updated dependencies [1d8c883]
  - @anvia/openai@0.3.23

## 0.2.8

### Patch Changes

- Updated dependencies [d9ac48c]
  - @anvia/openai@0.3.22

## 0.2.7

### Patch Changes

- Updated dependencies [5b0719c]
  - @anvia/openai@0.3.21

## 0.2.6

### Patch Changes

- Updated dependencies [8b7fe0d]
  - @anvia/openai@0.3.20

## 0.2.5

### Patch Changes

- Updated dependencies [b5f285a]
  - @anvia/openai@0.3.19

## 0.2.4

### Patch Changes

- 433f642: Simplify provider request and response object construction while preserving adapter behavior.
- Updated dependencies [433f642]
  - @anvia/openai@0.3.18

## 0.2.3

### Patch Changes

- Updated dependencies [204d342]
  - @anvia/openai@0.3.17

## 0.2.2

### Patch Changes

- Updated dependencies [498e95b]
  - @anvia/openai@0.3.16

## 0.2.1

### Patch Changes

- 32171dc: Add provider model-name types for autocomplete while preserving custom string model IDs.
- Updated dependencies [32171dc]
  - @anvia/openai@0.3.15

## 0.2.0

### Minor Changes

- bfa3c9b: Add a first-class Grok provider package for xAI completions, image generation, and model listing.
