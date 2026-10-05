# @anvia/anthropic

Run Anvia agents on Claude through Anthropic, Vertex AI, or an Anthropic-compatible
endpoint. Keep your tools and agent workflow while changing the model provider.

## Install

```sh
pnpm add @anvia/anthropic @anvia/core
```

## Quickstart

Set `ANTHROPIC_API_KEY` before running this example.

```ts
import { Agent } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
const agent = new Agent({
  id: "assistant",
  model: client.completionModel({ modelId: "claude-opus-5" }),
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({
  prompt: "What should I check before launching a new product?",
});

if (result.type === "response") {
  console.log(result.output);
}
```

## What you can build

- Streaming completions, tool calls, image inputs, and document inputs.
- Typed reasoning controls for supported Claude models.
- `AnthropicVertexClient` for Google Cloud authentication and routing.
- Custom endpoints through `baseUrl`; model listing on `AnthropicClient`.

For Vertex AI, use `AnthropicVertexClient` with your Google Cloud project and region.
The usage guide covers Application Default Credentials and custom authentication.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-anthropic.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
