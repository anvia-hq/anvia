# @anvia/openai

OpenAI provider adapter for Anvia.

Use this package when you want Anvia agents, extractors, pipelines, embeddings, image generation, audio generation, or transcription to run on OpenAI models or OpenAI-compatible endpoints.

## Installation

```sh
pnpm add @anvia/openai @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/openai build
```

## Usage

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
});

const model = client.completionModel("gpt-5");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize Anvia in one sentence.").send();

console.log(response.output);
```

## OpenAI-Compatible APIs

When `baseUrl` is provided, `OpenAIClient` uses the chat-completions-compatible adapter by default:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
  baseUrl,
});

const model = client.completionModel("openai/gpt-5.2");
```

You can also force a specific completion API with `completionApi: "responses"` or `completionApi: "chat"`.

## Other Models

```ts
const embeddingModel = client.embeddingModel("text-embedding-3-small");
const imageModel = client.imageGenerationModel();
const audioModel = client.audioGenerationModel();
const transcriptionModel = client.transcriptionModel();
```

## Exports

- `OpenAIClient`
- `OpenAIResponsesCompletionModel`
- `OpenAIChatCompletionModel`
- `OpenAIEmbeddingModel`
- `OpenAIImageGenerationModel`
- `OpenAIAudioGenerationModel`
- `OpenAITranscriptionModel`
- model constants such as `GPT_IMAGE_1`, `DALL_E_3`, `TTS_1`, and `WHISPER_1`
- `openai`

## Development

```sh
pnpm --filter @anvia/openai typecheck
pnpm --filter @anvia/openai test
pnpm --filter @anvia/openai build
```
