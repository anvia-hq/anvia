# @anvia/otel

Send Anvia agent and pipeline traces to your OpenTelemetry backend. Use the observability infrastructure your application already runs, with correlated evaluations and feedback.

## Installation

```sh
pnpm add @anvia/otel @anvia/core @anvia/openai
```

## Quick start

Initialize your application’s OpenTelemetry SDK and exporter before running this example. Set `OPENAI_API_KEY`.

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createOtelObserver } from "@anvia/otel";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new Agent({
  id: "support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  observability: {
    observers: { otel: createOtelObserver({ captureMode: "safe" }) },
    primaryTrace: "otel",
  },
});

const result = await agent.generate({ prompt: "How do refunds work?" });
if (result.type === "response") console.log(result.output);
console.log(result.trace?.traceId);
```

## What you get

- Agent and pipeline spans with model, tool, and runtime events.
- Evaluation reports and runtime feedback through OpenTelemetry logs.
- Prompt identity and trace correlation.
- Configurable capture limits and transformation hooks.

Your application owns SDK initialization, exporting, and shutdown. Evaluation reports and scores require a logs provider in addition to tracing. Safe capture omits prompt and response bodies; error text and metadata have separate transformation hooks.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/observability-otel.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
