# @anvia/openai

OpenAI provider adapter for Anvia.

Use this package when you want Anvia agents, direct completions, embeddings, image generation,
speech generation, or transcription to run on OpenAI models or OpenAI-compatible endpoints.

## Installation

```sh
pnpm add @anvia/openai @anvia/core
```

### Bun

Bun 1.3.14 is the currently tested and supported runtime baseline:

```sh
bun add @anvia/openai@rc @anvia/core@rc
```

Compatibility tests exercise the OpenAI SDK's JSON, streaming, abort, multipart, and binary media
paths without contacting a model provider.

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/openai build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
});

const model = client.completionModel({ modelId: "gpt-5.6", api: "responses" });

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

// The model-specific union is inferred: none | low | medium | high | xhigh | max.
await agent.generate({ prompt: "Solve this.", controls: { reasoningEffort: "high" } });

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.type === "response") console.log(result.output);
```

## OpenAI-Compatible APIs

`baseUrl` changes only the endpoint. Choose the protocol on each model handle explicitly:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
  baseUrl,
});

const model = client.completionModel({ modelId: "openai/gpt-5.2", api: "chat" });
```

The same client can create both `{ api: "responses" }` and `{ api: "chat" }` handles.
Known reasoning models advertise a typed `reasoningEffort` control. For custom OpenAI-compatible
model IDs, pass an explicit `controls` descriptor to `completionModel()` when the endpoint supports
the same parameter. Canonical controls map to `reasoning.effort` for Responses and
`reasoning_effort` for Chat Completions, taking precedence over conflicting `providerOptions`.

### Reasoning tool-call providers

Some OpenAI-compatible chat-completions providers return reasoning in provider-specific
fields while using normal tool calls. For example, Moonshot Kimi K2.6 returns
`reasoning_content` when thinking is enabled.

The chat-completions adapter preserves this reasoning in assistant history and sends it
back as `reasoning_content` on later turns. This matters after tool calls: providers
such as Moonshot can reject the next request if an assistant `tool_calls` message is
missing its prior `reasoning_content`.

For Moonshot Kimi K2.6 thinking mode:

```ts
import { generateCompletion } from "@anvia/core";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.moonshot.ai/v1",
});

const model = client.completionModel({ modelId: "kimi-k2.6", api: "chat" });

const response = await generateCompletion({
  model,
  messages: chatHistory,
  tools,
  maxTokens: 16_000,
  providerOptions: {
    thinking: { type: "enabled", keep: "all" },
  },
});
```

Provider caveat: Moonshot rejects forced/specified `tool_choice` while thinking is
enabled. Let the model choose tools naturally when using Kimi thinking mode.

## Other Models

```ts
const embeddingModel = client.embeddingModel({ modelId: "text-embedding-3-small" });
const imageModel = client.imageGenerationModel({ modelId: "gpt-image-2" });
const speechModel = client.speechGenerationModel({ modelId: "gpt-4o-mini-tts" });
const transcriptionModel = client.transcriptionModel({ modelId: "gpt-4o-mini-transcribe" });
```

Use the provider-neutral helpers from `@anvia/core` to call media models:

```ts
import { generateImage, generateSpeech, transcribe } from "@anvia/core";

const image = await generateImage({ model: imageModel, prompt: "A launch poster." });
const speech = await generateSpeech({
  model: speechModel,
  text: "Hello from Anvia.",
  voice: "alloy",
});
const transcript = await transcribe({
  model: transcriptionModel,
  audio: { data: speech.audio.data, filename: "speech.mp3" },
});
```

## Exports

- `OpenAIClient`
- structural completion, embedding, image, speech, and transcription handle types
- `OpenAICompletionModelId` and media model-ID types
- model constants such as `GPT_IMAGE_2`, `GPT_4O_MINI_TTS`, and `GPT_TRANSCRIBE`
- `openai`

## Development

The package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath
types are available in a fresh worktree.

```sh
pnpm --filter @anvia/openai typecheck
pnpm --filter @anvia/openai test
pnpm --filter @anvia/openai build
```
