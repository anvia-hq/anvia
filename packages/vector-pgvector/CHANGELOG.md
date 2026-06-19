# @anvia/pgvector

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
