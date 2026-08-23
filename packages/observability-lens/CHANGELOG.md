# @anvia/lens

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11
  - @anvia/otel@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10
  - @anvia/otel@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9
  - @anvia/otel@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8
  - @anvia/otel@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7
  - @anvia/otel@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6
  - @anvia/otel@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5
  - @anvia/otel@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4
  - @anvia/otel@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [475ae22]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/core@1.0.0-rc.3
  - @anvia/otel@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 640dd3c: Redesign observability around named Agent observers, explicit primary trace provenance, and
  object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
  Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
  and preserve observer identity through client streams and Studio traces.
  Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
  different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
  strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
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
  - @anvia/otel@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @anvia/core@1.0.0-rc.1
  - @anvia/otel@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 4564d2f: Prepare the synchronized Anvia 1.0 release train.

### Patch Changes

- Updated dependencies [4564d2f]
- Updated dependencies [4ab25bb]
  - @anvia/core@1.0.0-rc.0
  - @anvia/otel@1.0.0-rc.0

## 0.5.2

### Patch Changes

- Updated dependencies [4b9f9cc]
  - @anvia/otel@0.8.0

## 0.5.1

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.
- Updated dependencies [615b767]
  - @anvia/otel@0.7.1

## 0.5.0

### Minor Changes

- 36f8324: Add first-party eval CLI result handling, deterministic and abstention metrics, explicit case and
  metric totals, score direction, usage and optional cost aggregation, and negative-control
  assertions. Add optional Lens environment configuration, bundled eval setup, and run-end flushing,
  and migrate observability and Studio consumers to the richer eval result contract. Improve eval
  type safety with readonly suite definitions, metric-aware case requirements, literal-name score
  maps, contravariant reporters, suite-bound custom metrics, and explicit prompt output selectors.

### Patch Changes

- Updated dependencies [36f8324]
  - @anvia/otel@0.7.0

## 0.4.0

### Minor Changes

- 3a4186a: Add an authenticated managed-dataset client that fetches immutable published versions with
  automatic pagination and returns cases ready for `@anvia/core/evals`.

## 0.3.0

### Minor Changes

- 6a8810b: Add opt-in evaluation case payload capture with inherited redaction and size limits.

### Patch Changes

- Updated dependencies [6a8810b]
  - @anvia/otel@0.6.0

## 0.2.0

### Minor Changes

- e55a792: Add first-class evaluation run identity and lifecycle reporting so Anvia Lens can group completed
  suites, compare releases, and apply quality gates.

### Patch Changes

- Updated dependencies [e55a792]
  - @anvia/otel@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [d02b1f5]
  - @anvia/otel@0.4.0

## 0.1.0

### Minor Changes

- Add native Anvia Lens agent tracing and correlated OpenTelemetry evaluation reporting.
