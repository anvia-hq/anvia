# @anvia/otel

OpenTelemetry tracing adapter for Anvia.

Use this package to emit Anvia agent observer events as standard OpenTelemetry spans. The adapter uses your application's existing OpenTelemetry SDK or global tracer provider; it does not start, flush, or shut down an SDK.

## Installation

```sh
pnpm add @anvia/otel @anvia/core @opentelemetry/api
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

## Exports

- `otel`
- `OtelTracing`
- `OtelTracingOptions`

## Development

```sh
pnpm --filter @anvia/otel typecheck
pnpm --filter @anvia/otel test
pnpm --filter @anvia/otel build
```
