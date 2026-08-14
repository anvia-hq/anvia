# @anvia/memory-drizzle

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

## 0.4.0

### Minor Changes

- dd685cc: Add a safe `init` CLI that can dry-run, generate, or append the canonical Drizzle memory schema
  exports with conflict and overwrite protection.

## 0.3.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.3.0

### Minor Changes

- eff30fb: Add opt-in, model-generated durable memory compaction with atomic conflict detection, official
  database-adapter support, aggregate usage accounting, and React hydration that hides synthetic
  summary messages by default.

## 0.2.3

### Patch Changes

- ede828b: Add optional read-only memory inspection, implement it across the database memory adapters, and let
  Studio discover persisted agent conversations before falling back to Studio session storage.

## 0.2.2

### Patch Changes

- 433f642: Simplify optional memory record construction while preserving persistence behavior.

## 0.2.1

### Patch Changes

- 83b36e2: Preserve strict JSON message metadata in durable memory adapters and Studio's normalized SQLite session storage.

## 0.2.0

### Minor Changes

- 8d880dd: Add durable session memory adapters for Prisma, Drizzle, SQLite, and Postgres.

## 0.1.0

- Add a Drizzle-backed durable memory store and exported Postgres table schema.
