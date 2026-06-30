# @anvia/grok

Grok provider adapter for Anvia.

Use this package when you want Anvia agents, extractors, pipelines, image generation, or model listing to run on xAI Grok APIs.

## Installation

```sh
pnpm add @anvia/grok @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/grok build
```

## Usage

```ts
import { AgentBuilder } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey,
});

const model = client.completionModel("grok-4.3");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize Anvia in one sentence.").send();

console.log(response.output);
```

## Completion APIs

`GrokClient` targets `https://api.x.ai/v1` by default and uses the Responses adapter by default:

```ts
const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});
```

Use the Chat Completions adapter when a workflow specifically needs that surface:

```ts
const chatClient = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
  completionApi: "chat",
});
```

Provider-specific xAI parameters can be passed through completion `additionalParams`.

```ts
const response = await model.completion({
  chatHistory,
  documents: [],
  tools,
  additionalParams: {
    reasoning: { effort: "high" },
  },
});
```

## Image Generation

```ts
import { GROK_IMAGINE_IMAGE, GrokClient } from "@anvia/grok";

const client = new GrokClient({ apiKey });
const imageModel = client.imageGenerationModel(GROK_IMAGINE_IMAGE);

const result = await imageModel.imageGeneration({
  prompt: "A compact robot drawing architecture diagrams on a glass wall.",
  width: 1024,
  height: 1024,
});

console.log(result.mediaType, result.image.byteLength);
```

The adapter requests base64 responses by default. If xAI returns image URLs, it fetches those URLs and returns bytes to satisfy Anvia's core image generation contract.

## Model Listing

```ts
const models = await client.listModels();
```

Use listing for inventory. Keep a separate app allowlist for production-enabled model ids.

## Unsupported xAI SDK Surfaces

The xAI Python SDK also exposes native video, tokenizer, files, batch, collections, stored completions, compaction, deferred chat, and telemetry APIs. This package does not implement those in v1 because Anvia core does not currently expose matching provider-neutral contracts.

## Exports

- `GrokClient`
- `GrokResponsesCompletionModel`
- `GrokChatCompletionModel`
- `GrokImageGenerationModel`
- model constants such as `GROK_4_3`, `GROK_4_20`, and `GROK_IMAGINE_IMAGE`
- `grok`

## Development

```sh
pnpm --filter @anvia/grok typecheck
pnpm --filter @anvia/grok test
pnpm --filter @anvia/grok build
```

Package-local `typecheck` and `build` scripts build `@anvia/openai` first so delegated adapter types are available in a fresh worktree. `@anvia/openai` builds `@anvia/core` when needed.
