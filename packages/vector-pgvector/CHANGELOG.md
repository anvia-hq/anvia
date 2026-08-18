# @anvia/pgvector

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

- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 927f81b: Replace model-bound vector indexes and positional embedding helpers with explicit vector clients,
  raw-vector stores, object-argument embedding helpers, retrieval composition, vector search tools,
  and agent vector contexts. Add lazy provider clients for all vector adapters, explicit resource
  lifecycle methods, replacement upserts, dense and hybrid retrieval, abort propagation, and opt-in
  retries. Normalize provider scores so larger values are consistently better, return `topK` logical
  documents even when documents have multiple chunks, and require explicit Redis metadata indexing
  for filtered search.
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

## 0.2.12

### Patch Changes

- 433f642: Simplify optional vector query and result construction while preserving vector store behavior.

## 0.2.11

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.2.10

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.2.9

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.2.8

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.2.7

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.2.6

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.2.5

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.2.4

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [4ab66c9]
  - @anvia/core@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [4c1620d]
  - @anvia/core@0.4.2

## 0.2.1

### Patch Changes

- Updated dependencies [95712d8]
  - @anvia/core@0.4.1

## 0.2.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

### Patch Changes

- Updated dependencies [e84d775]
  - @anvia/core@0.4.0

## 0.1.6

### Patch Changes

- b12932d: Update upstream dependencies for PDF loading, globbing, Langfuse tracing, and pgvector support.

  The PDF loader now destroys the `pdfjs-dist` loading task after reading pages, matching the v6 cleanup API.

- Updated dependencies [b12932d]
  - @anvia/core@0.3.1

## 0.1.5

### Patch Changes

- Updated dependencies [09c70f5]
  - @anvia/core@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [a0a5def]
  - @anvia/core@0.2.4

## 0.1.3

### Patch Changes

- 1f7d3aa: Republish packages with registry-safe dependency metadata.

## 0.1.2

### Patch Changes

- 1ad360d: Fix Anthropic-compatible streaming tool inputs and update provider dependencies.
