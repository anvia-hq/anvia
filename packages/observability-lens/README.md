# @anvia/lens

Connect Anvia agents to Anvia Lens for tracing, evaluations, scores, datasets, and prompts. Follow a conversation from model calls to tool results, then use the same traces to evaluate quality.

## Installation

```sh
pnpm add @anvia/lens @anvia/core @anvia/openai
```

## Quick start

Use Node.js 24 or later. Set `OPENAI_API_KEY` and your `ANVIA_LENS_BASE_URL`, `ANVIA_LENS_PUBLIC_KEY`, and `ANVIA_LENS_SECRET_KEY`.

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { LensClient } from "@anvia/lens";

await using telemetry = new LensClient({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
});
const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new Agent({
  id: "support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  observability: {
    observers: { lens: telemetry.observer({ captureMode: "safe" }) },
    primaryTrace: "lens",
  },
});

const result = await agent.generate({ prompt: "How do refunds work?" });
if (result.type === "response") {
  console.log(result.output);
  console.log(result.trace);
}
```

## What you get

- Agent tracing with configurable capture and redaction.
- Pipeline tracing through the same client.
- Trace-correlated scores and evaluation results.
- Dataset access and reusable prompts.
- Isolated telemetry providers with explicit flush and cleanup.

`captureMode: "safe"` omits prompt and response bodies. Keep the client alive while agents run; `await using` flushes and closes it at scope exit. See the guide for redaction and graceful server shutdown.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/observability-lens.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
