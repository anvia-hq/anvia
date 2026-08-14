# @anvia/lens

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
