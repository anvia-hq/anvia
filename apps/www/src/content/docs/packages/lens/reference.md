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
};
```

Creates an isolated Node.js trace and log pipeline that exports to the configured Lens project.

## LensTracingOptions

Configures `baseUrl`, `publicKey`, `secretKey`, `serviceName`, `environment`, `release`, request
timeout, capture mode, capture size limit, and redaction. Explicit options take precedence over the
matching `ANVIA_LENS_*` environment variables.

## LensTracing

An Anvia `AgentObserver` with asynchronous `flush()` and idempotent `shutdown()` methods.

## createLensEvalReporter

```ts
function createLensEvalReporter<Input, Output, Expected>(
  tracing: LensTracing,
  options?: LensEvalReporterOptions,
): LensEvalReporter<Input, Output, Expected>;
```

Emits evaluation-run lifecycle events and standard `gen_ai.evaluation.result` log events through
the isolated Lens log provider. Evaluation metadata is omitted by default and can be enabled with
`includeMetadata: true`.

## Configuration and redaction helpers

`resolveLensConfig` resolves and validates configuration. `createLensRedactor` returns a deep,
non-mutating redactor. `DEFAULT_PATTERNS` contains the built-in patterns. Public supporting types
are `LensCaptureMode`, `LensEvalReporter`, `LensEvalReporterOptions`, `LensRedactionOptions`,
`LensRedactorPattern`, `LensTracing`, and `LensTracingOptions`.
