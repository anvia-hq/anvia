---
title: "OpenTelemetry"
description: "Public exports from @anvia/otel."
section: packages
sidebar:
  group: "otel"
  order: 6
  label: "OpenTelemetry"
---
Import from `@anvia/otel`.

## OtelTracingOptions

```ts
type OtelTracingOptions = {
  tracer?: Tracer;
  tracerName?: string;
  tracerVersion?: string;
  serviceName?: string;
  captureMode?: "safe" | "full";
  captureMaxBytes?: number;
  transformInput?: (value: unknown) => unknown;
  transformOutput?: (value: unknown) => unknown;
};
```

Purpose: configure the OpenTelemetry tracer used by the adapter.

Return behavior: consumed by `otel.create(...)`.

Notable behavior: when `tracer` is omitted, the adapter calls `trace.getTracer(tracerName ?? "@anvia/otel", tracerVersion)`. Set safe capture to omit payload attributes. When capture mode is omitted, existing full-capture behavior is retained; payloads are bounded after applying optional transforms when a size is configured.

## OtelTracing

```ts
type OtelTracing = AgentObserver;
```

Purpose: Agent observer that emits OpenTelemetry spans.

Return behavior: can be passed to `AgentBuilder.observe(...)`.

Notable behavior: the adapter does not start, flush, or shut down an OpenTelemetry SDK.

## otel

```ts
const otel: {
  create(options?: OtelTracingOptions): OtelTracing;
};
```

Purpose: factory for OpenTelemetry tracing observers.

Return behavior: creates an observer that emits root run spans, generation spans, and tool spans through the configured tracer.

Notable behavior: if an Anvia trace contains a valid 32-character hex `traceId`, the root span is parented under a synthetic remote parent so emitted spans join that trace.

## Eval reporter

```ts
type OtelEvalReporterOptions = {
  logger?: Logger;
  loggerName?: string;
  loggerVersion?: string;
  publishInvalid?: boolean;
  includeMetadata?: boolean;
  onMissingTrace?: "emit" | "ignore" | "warn" | "throw";
};

function createOtelEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  options?: OtelEvalReporterOptions,
): EvalReporter<Input, Output, Expected>;
```

Purpose: emit each metric result as an OpenTelemetry `gen_ai.evaluation.result` event.

Return behavior: uses the supplied logger or the global OpenTelemetry logger provider. Valid trace
and observation ids correlate the event with the evaluated span. Without trace context, events are
still emitted by default; `onMissingTrace` can ignore, warn, or throw instead.

Notable behavior: numeric scores use `gen_ai.evaluation.score.value`; all outcomes include a score
label and Anvia suite/case attributes. Invalid outcomes are emitted unless `publishInvalid` is false.
