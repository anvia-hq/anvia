---
title: "Anvia Lens"
description: "Public exports from @anvia/lens."
section: packages
sidebar:
  group: "@anvia/lens"
  order: 6
  label: "Anvia Lens"
---
Import from `@anvia/lens`.

## lens

```ts
const lens: {
  create(options?: LensTracingOptions): LensTracing;
  createFromEnv(options?: LensFromEnvOptions): LensTracing;
  evals(options?: LensEvalsOptions): LensEvalIntegration;
};
```

`create` creates an isolated Node.js trace and log pipeline. `createFromEnv({ optional: true })`
returns disabled no-op tracing when all Lens connection variables are absent, while partial
configuration still throws. `evals` bundles one observer, reporter, `flush`, and `shutdown`, and
enables run-end flushing by default.

## LensTracingOptions

Configures `baseUrl`, `publicKey`, `secretKey`, `serviceName`, `environment`, `release`, request
timeout, capture mode, capture size limit, and redaction. Explicit options take precedence over the
matching `ANVIA_LENS_*` environment variables.

## LensTracing

An Anvia `AgentObserver` with `enabled`, asynchronous `flush()`, and idempotent `shutdown()`.

## createLensEvalReporter

```ts
function createLensEvalReporter<Input, Output, Expected>(
  tracing: LensTracing,
  options?: LensEvalReporterOptions,
): LensEvalReporter<Input, Output, Expected>;
```

Emits evaluation-run lifecycle events and standard `gen_ai.evaluation.result` log events through
the isolated Lens log provider. Evaluation metadata and case payloads are omitted by default.
Enable them independently with `includeMetadata: true` and `includePayloads: true`. Captured
evaluation payloads inherit the tracing instance's redaction transforms and capture-size limit.
Set `flushOnRunEnd: true` for short-lived processes.

## createLensDatasetClient

```ts
function createLensDatasetClient(
  tracing: LensTracing,
  options?: LensDatasetClientOptions,
): LensDatasetClient;
```

Creates an authenticated client for published managed datasets. `getDataset(name, { version? })`
returns a `LensDataset` with paginated `LensDatasetItem` values. It selects the latest published
version when no version is supplied and throws `LensDatasetError` for API, network, and invalid
response failures.

## Configuration and redaction helpers

`resolveLensConfig` resolves and validates configuration. `createLensRedactor` returns a deep,
non-mutating redactor. `DEFAULT_PATTERNS` contains the built-in patterns. Public supporting types
are `LensCaptureMode`, `LensDataset`, `LensDatasetClient`, `LensDatasetClientOptions`,
`LensDatasetGetOptions`, `LensDatasetItem`, `LensEvalIntegration`, `LensEvalsOptions`,
`LensEvalReporter`, `LensEvalReporterOptions`, `LensFromEnvOptions`, `LensRedactionOptions`,
`LensRedactorPattern`, `LensTracing`, and `LensTracingOptions`.
