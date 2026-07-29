# @anvia/grok

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
