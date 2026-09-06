# @anvia/graph

## 1.1.2

### Patch Changes

- f998fd6: Move `zod` from `dependencies` to `peerDependencies` (`^4.4.0`). These packages expose zod types in their public API, so declaring zod as a regular dependency forced consumers to install a second, incompatible copy whenever their own zod version differed. Typechecks against such projects failed with `TS2769` (`ZodSchema`/`def.checks` incompatibility between the two copies) and type instantiation could become slow enough to crash `tsc` on large codebases. With zod as a peer dependency, consumers compile and run against a single shared copy. Local development and tests now resolve zod through `devDependencies` (`^4.5.4`); zod 4.4.x is verified to satisfy the floor.
- Updated dependencies [f998fd6]
  - @anvia/core@1.1.2

## 1.1.1

### Patch Changes

- f48bb95: Bump upstream runtime dependencies to their latest versions and align zod to 4.5.4 across all packages and workspaces.
- Updated dependencies [f48bb95]
  - @anvia/core@1.1.1

## 1.0.12

### Patch Changes

- Updated dependencies [2277090]
  - @anvia/core@1.0.10

## 1.0.11

### Patch Changes

- Updated dependencies [68953da]
  - @anvia/core@1.0.9

## 1.0.10

### Patch Changes

- 0891239: Add configurable property-level graph extraction conflict resolution with structured warnings and
  errors, durable ingestion receipts with optional graph-plus-vector orchestration, explorer source
  provenance, and shared-resource tenant namespaces for managed Neo4j graphs and Qdrant stores.

## 1.0.9

### Patch Changes

- Updated dependencies [18344a2]
  - @anvia/core@1.0.8

## 1.0.8

### Patch Changes

- Updated dependencies [9e5e068]
  - @anvia/core@1.0.7

## 1.0.7

### Patch Changes

- Updated dependencies [32cffc0]
  - @anvia/core@1.0.6

## 1.0.6

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/core@1.0.5

## 1.0.5

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4

## 1.0.4

### Patch Changes

- 3113e9a: Add matching raw-text ingestion helpers for vector stores and managed knowledge graphs, including
  shared deterministic chunking and reusable graph/vector embeddings.
- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3

## 1.0.3

### Patch Changes

- 5ca833e: Add provider-neutral knowledge graph primitives, a schema-first Memgraph GraphRAG adapter, and
  graph-bound retrieval for portable Neo4j and Memgraph applications. Standardize Agent integration
  on the shared `createGraphSearchTool()` factory with evidence-aware typing. Add bounded graph
  exploration to both adapters and a searchable, expandable graph explorer in Studio.
