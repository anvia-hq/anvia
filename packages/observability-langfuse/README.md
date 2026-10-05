# @anvia/langfuse

Connect Anvia agents to Langfuse for tracing, evaluations, scores, datasets, and prompts. Follow a conversation from model calls to tool results, then use the same traces to evaluate quality.

## Installation

```sh
pnpm add @anvia/langfuse @anvia/core @anvia/openai
```

## Quick start

Set `OPENAI_API_KEY` and your `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`.

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { LangfuseClient } from "@anvia/langfuse";

await using telemetry = new LangfuseClient({
  baseUrl: process.env.LANGFUSE_BASE_URL,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
});
const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new Agent({
  id: "support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  observability: {
    observers: { langfuse: telemetry.observer({ captureMode: "safe" }) },
    primaryTrace: "langfuse",
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
- Evaluation reporting and dataset experiments.
- Trace-correlated scores and evaluation results.
- Dataset access and reusable prompts.
- Isolated telemetry providers with explicit flush and cleanup.

`captureMode: "safe"` omits prompt and response bodies. Keep the client alive while agents run; `await using` flushes and closes it at scope exit. See the guide for redaction and graceful server shutdown.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/observability-langfuse.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
