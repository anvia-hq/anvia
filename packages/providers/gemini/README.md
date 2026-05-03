# @anvia/gemini

Gemini and Vertex AI provider adapter for Anvia.

Use this package when you want Anvia agents, extractors, pipelines, embeddings, image generation, or transcription to run on Google's Gemini APIs.

## Installation

```sh
pnpm add @anvia/gemini @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/gemini build
```

## Usage

```ts
import { AgentBuilder } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey,
});

const model = client.completionModel("gemini-2.5-flash");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize Anvia in one sentence.").send();

console.log(response.output);
```

## Vertex AI

Use Vertex AI by passing `vertexai: true` with a Google Cloud project and location:

```ts
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  vertexai: true,
  project: "my-gcp-project",
  location: "us-central1",
});

const model = client.completionModel("gemini-2.5-flash");
```

## Embeddings

```ts
const embeddings = client.embeddingModel("gemini-embedding-001");
const vectors = await embeddings.embedTexts(["Anvia is a TypeScript AI runtime."]);
```

## Image Generation

`imageGenerationModel()` uses Gemini native image generation models such as Nano Banana.
Use `imagenGenerationModel()` when you specifically want Imagen.

```ts
import { GEMINI_2_5_FLASH_IMAGE, IMAGEN_4_GENERATE, GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({ apiKey });

const nativeImageModel = client.imageGenerationModel(GEMINI_2_5_FLASH_IMAGE);
const imagenModel = client.imagenGenerationModel(IMAGEN_4_GENERATE);
```

## Exports

- `GeminiClient`
- `GeminiCompletionModel`
- `GeminiEmbeddingModel`
- `GeminiImageGenerationModel`
- `GeminiImagenGenerationModel`
- `GeminiTranscriptionModel`
- `GEMINI_2_5_FLASH_IMAGE`
- `GEMINI_3_PRO_IMAGE_PREVIEW`
- `IMAGEN_4_GENERATE`
- `gemini`

## Development

```sh
pnpm --filter @anvia/gemini typecheck
pnpm --filter @anvia/gemini test
pnpm --filter @anvia/gemini build
```
