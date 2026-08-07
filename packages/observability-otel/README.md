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
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { otel } from "@anvia/otel";

const tracing = otel.create({
  serviceName: "support-agent",
  captureMode: "safe",
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new AgentBuilder("support", client.completionModel())
  .instructions("Answer support questions clearly.")
  .observe(tracing)
  .build();

const response = await agent.prompt("How do I reset my password?").send();

console.log(response.output);
console.log(response.trace?.traceId);
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
  target: agentEvalTarget(supportAgent),
  metrics,
  reporters: [createOtelEvalReporter({ onMissingTrace: "warn" })],
});
```

The reporter emits `gen_ai.evaluation.result` through the OpenTelemetry logs API. When the target
returns valid `traceId` and `observationId` values, the event is correlated with the evaluated span.
It otherwise emits an uncorrelated event by default. Configure a logs SDK/exporter in addition to
your trace exporter, or inject a `Logger` with the `logger` option.

Set `includeMetadata: false` to omit case, metric, and outcome metadata. Invalid outcomes are
reported by default and can be disabled with `publishInvalid: false`.

## Exports

- `otel`
- `createOtelEvalReporter`
- `OtelEvalReporterOptions`
- `OtelTracing`
- `OtelTracingOptions`

## Development

```sh
pnpm --filter @anvia/otel typecheck
pnpm --filter @anvia/otel test
pnpm --filter @anvia/otel build
```
