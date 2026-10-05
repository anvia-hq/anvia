# @anvia/mistral

Run Anvia agents, extraction workflows, and semantic search on Mistral. Add OCR
when your application needs to turn document URLs or uploaded files into Markdown.

## Install

```sh
pnpm add @anvia/mistral @anvia/core
```

## Quickstart

Set `MISTRAL_API_KEY` before running this example.

```ts
import { Agent } from "@anvia/core";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({
  apiKey: process.env.MISTRAL_API_KEY!,
});
const agent = new Agent({
  id: "assistant",
  model: client.completionModel({ modelId: "mistral-medium-3-5" }),
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

- Streaming completions, tools, tool choice, and structured output.
- Embedding models for semantic search.
- OCR models with page-level output and combined Markdown.
- Model listing and custom endpoints through `baseUrl`.

Chat image inputs, binary document inputs, transcription, and media generation are
not implemented. Use the OCR model for document processing.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-mistral.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
