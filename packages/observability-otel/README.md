# @anvia/otel

OpenTelemetry tracing and eval reporting adapter for Anvia.

Use this package to emit Anvia agent observer events as standard OpenTelemetry spans. The adapter uses your application's existing OpenTelemetry SDK or global tracer provider; it does not start, flush, or shut down an SDK.

## Installation

```sh
pnpm add @anvia/otel @anvia/core @opentelemetry/api @opentelemetry/api-logs
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/otel build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createOtelObserver } from "@anvia/otel";

const tracing = createOtelObserver({
  serviceName: "support-agent",
  captureMode: "safe",
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-5", api: "responses" }),
  instructions: "Answer support questions clearly.",
  observability: {
    observers: { otel: tracing },
    primaryTrace: "otel",
  },
});

const result = await agent.generate({ prompt: "How do I reset my password?" });

if (result.status === "completed") console.log(result.output);
console.log(result.status === "approval_required" ? undefined : result.trace?.traceId);
```

Initialize OpenTelemetry in your application before creating spans. For OTLP HTTP, configure `@opentelemetry/sdk-node` and `@opentelemetry/exporter-trace-otlp-http` in your app process.

Set `captureMode: "safe"` to record operational attributes without prompt or response bodies.
Existing `@anvia/otel` integrations retain full capture when the option is omitted. Use
`captureMaxBytes` to set a per-value limit and `transformInput` / `transformOutput` to redact or
reshape payloads before export. Runtime observer events are emitted as OpenTelemetry span events.

## Eval reporting

```ts
import { agentEvalTarget, runEvalSuite } from "@anvia/core/evals";
import { createOtelEvalReporter } from "@anvia/otel";

const result = await runEvalSuite({
  name: "support-regression",
  cases,
  target: agentEvalTarget<string>({
    agent: supportAgent,
    request: ({ input }) => ({ prompt: input }),
  }),
  metrics,
  reporters: [createOtelEvalReporter({ onMissingTrace: "warn" })],
});
```

The reporter emits `gen_ai.evaluation.result` through the OpenTelemetry logs API. When the target
returns valid `traceId` and `observationId` values, the event is correlated with the evaluated span.
It otherwise emits an uncorrelated event by default. Configure a logs SDK/exporter in addition to
your trace exporter, or inject a `Logger` with the `logger` option.

Trace provenance is checked against the `"otel"` Agent observer registration by default. Set
`traceObserver` when the OpenTelemetry observer is registered under another name.

Set `includeMetadata: false` to omit case, metric, and outcome metadata. Invalid outcomes are
reported by default and can be disabled with `publishInvalid: false`.
Metric events include required status, score direction, threshold, and evaluator token usage when
available. Run-finished events publish separate metric and case totals plus aggregate usage and
optional caller-calculated cost.

## Exports

- `createOtelObserver`
- `createOtelEvalReporter`
- `OtelObserverOptions`
- `OtelEvalReporterOptions`

## Development

```sh
pnpm --filter @anvia/otel typecheck
pnpm --filter @anvia/otel test
pnpm --filter @anvia/otel build
```
