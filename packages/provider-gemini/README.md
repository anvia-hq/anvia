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
import { Agent } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey,
});

const model = client.completionModel({ modelId: "gemini-2.5-flash" });

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.status === "completed") console.log(result.output);
```

## Vertex AI

Use the exclusive Vertex AI configuration with a Google Cloud project and location:

```ts
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  vertexAi: {
    projectId: "my-gcp-project",
    location: "us-central1",
  },
});

const model = client.completionModel({ modelId: "gemini-2.5-flash" });
```

The Google SDK uses Application Default Credentials. For a service-account JSON file, set
`GOOGLE_APPLICATION_CREDENTIALS` before starting the application:

```sh
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
```

Trusted credential objects can also be passed explicitly:

```ts
const client = new GeminiClient({
  vertexAi: {
    projectId: "my-gcp-project",
    location: "us-central1",
    googleAuthOptions: {
      credentials: serviceAccountJson,
    },
  },
});
```

Validate externally supplied credential configurations before using them. Never commit credential
JSON or service-account keys.

## Embeddings

```ts
const embeddings = client.embeddingModel({ modelId: "gemini-embedding-001" });
const vectors = await embeddings.embedTexts(["Anvia is a TypeScript AI runtime."]);
```

## Image Generation

Choose the image API explicitly. Gemini native image models use `generateContent`; Imagen uses
`generateImages`.

```ts
import { GEMINI_2_5_FLASH_IMAGE, IMAGEN_4_GENERATE, GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({ apiKey });

const nativeImageModel = client.imageGenerationModel({
  api: "generateContent",
  modelId: GEMINI_2_5_FLASH_IMAGE,
});
const imagenModel = client.imageGenerationModel({
  api: "generateImages",
  modelId: IMAGEN_4_GENERATE,
});
```

## Exports

- `GeminiClient`
- structural completion, embedding, image, and transcription handle types
- Gemini model-ID types
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

Package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath types are available in a fresh worktree.
