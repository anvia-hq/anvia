---
title: Gemini provider
description: Use @anvia/gemini for Gemini API and Vertex AI model capabilities.
section: providers
sidebar:
  group: Provider guides
  order: 30
---

`@anvia/gemini` adapts Google's `@google/genai` SDK to Anvia contracts. Use it for Gemini API or Vertex AI completions, embeddings, image generation, transcription, and model listing.

## Install

```bash
pnpm add @anvia/core @anvia/gemini
```

Create a Gemini API client with an API key:

```ts
import { GeminiClient } from "@anvia/gemini";

export const gemini = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});
```

Or create a Vertex AI client:

```ts
const vertexGemini = new GeminiClient({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: "us-central1",
});
```

`GeminiClient` requires either `apiKey` for Gemini API mode or `vertexai: true` with `project` and `location` for Vertex AI mode. You can also pass an already-created `GoogleGenAI` `client`.

### Vertex authentication

Vertex mode uses Google Application Default Credentials. Point ADC at a service-account JSON file
with `GOOGLE_APPLICATION_CREDENTIALS`:

```sh
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
```

For trusted credential objects or a preconfigured auth client, pass the Google SDK's
`googleAuthOptions`:

```ts
const vertexGemini = new GeminiClient({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: "us-central1",
  googleAuthOptions: {
    credentials: serviceAccountJson,
  },
});
```

Validate externally supplied credential configuration before using it, and never commit credential
JSON or service-account keys.

## Completion Models

```ts
import { AgentBuilder } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const gemini = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});

const model = gemini.completionModel("gemini-2.5-flash");

export const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();
```

`GeminiCompletionModel` supports streaming, tools, tool choice, image input, document input, output schemas, and reasoning content at the Anvia contract level.

Gemini-specific generation config belongs in completion `additionalParams.config`:

```ts
import { createCompletion } from "@anvia/core";

const response = await createCompletion(model, {
  input: "Draft a short release note.",
  params: {
    config: {
      topP: 0.8,
    },
  },
});
```

## Embeddings

```ts
const embeddings = gemini.embeddingModel("gemini-embedding-001", {
  taskType: "RETRIEVAL_DOCUMENT",
  dimensions: 768,
  maxBatchSize: 100,
});

const vectors = await embeddings.embedTexts(["Anvia is a TypeScript AI runtime."]);
```

`GeminiEmbeddingModelOptions` supports `dimensions`, `maxBatchSize`, `taskType`, and `title`.

## Image Generation

Gemini exposes two image model factories:

```ts
import {
  GEMINI_2_5_FLASH_IMAGE,
  IMAGEN_4_GENERATE,
  GeminiClient,
} from "@anvia/gemini";

const gemini = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});

const nativeImageModel = gemini.imageGenerationModel(GEMINI_2_5_FLASH_IMAGE);
const imagenModel = gemini.imagenGenerationModel(IMAGEN_4_GENERATE);
```

`imageGenerationModel(...)` uses Gemini native image generation through `models.generateContent`. `imagenGenerationModel(...)` uses Imagen through `models.generateImages`.

Both map the core width and height request to an aspect ratio. Use `additionalParams.config` for provider-specific image config such as output count or aspect behavior.

## Transcription

```ts
const transcriptionModel = gemini.transcriptionModel("gemini-2.5-flash");
```

Gemini transcription sends audio bytes as inline data to `models.generateContent`. The adapter infers a MIME type from the request filename and applies a transcription system instruction.

## Model Listing

```ts
const models = await gemini.listModels();
```

Gemini model listing normalizes model ids from Gemini API responses and Vertex AI compatible responses when available.

## Exports

The root package exports `GeminiClient`, `GeminiCompletionModel`, `GeminiEmbeddingModel`, `GeminiImageGenerationModel`, `GeminiImagenGenerationModel`, `GeminiTranscriptionModel`, `GeminiEmbeddingModelOptions`, `GeminiEmbeddingTaskType`, constants such as `GEMINI_2_5_FLASH_IMAGE`, `GEMINI_3_PRO_IMAGE_PREVIEW`, `IMAGEN_4_GENERATE`, and the `gemini` namespace.
