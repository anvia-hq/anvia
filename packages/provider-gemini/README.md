# @anvia/gemini

Run Anvia agents and retrieval workflows with Gemini. Connect through the Gemini
API or Vertex AI using the same provider-neutral agent interfaces.

## Install

```sh
pnpm add @anvia/gemini @anvia/core
```

## Quickstart

Set `GEMINI_API_KEY` before running this example.

```ts
import { Agent } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY!,
});
const agent = new Agent({
  id: "assistant",
  model: client.completionModel({ modelId: "gemini-3.7-flash" }),
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

- Streaming completions, tools, structured output, and typed reasoning controls.
- Embeddings with configurable task type and dimensions.
- Image generation through Gemini native models or Imagen.
- Transcription, model listing, and Vertex AI authentication.

For Vertex AI, pass `vertexAi: { projectId, location }` instead of `apiKey`.
The usage guide includes authentication and image API selection.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-gemini.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
