# @anvia/openai

Connect Anvia agents to OpenAI or an OpenAI-compatible endpoint. Use one client for
chat, embeddings, images, speech, and transcription.

For Azure OpenAI and Azure AI Foundry, use
[`@anvia/azure`](../provider-azure/README.md) for Azure endpoint and authentication configuration.

## Install

```sh
pnpm add @anvia/openai @anvia/core
```

## Quickstart

Set `OPENAI_API_KEY` before running this example.

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY!,
});
const agent = new Agent({
  id: "assistant",
  model: client.completionModel({ modelId: "gpt-5.6", api: "responses" }),
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

- Chat Completions and Responses APIs, streaming, tools, and structured output.
- Typed reasoning controls for supported models.
- Embeddings, image generation, speech generation, transcription, and model listing.
- Custom endpoints through `baseUrl`.

Model handles default to Chat Completions. The example selects Responses explicitly.
Bun users can install the same packages with `bun add`.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-openai.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
