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
const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.moonshot.ai/v1",
});

const model = client.completionModel("kimi-k2.6");

const response = await model.completion({
  chatHistory,
  documents: [],
  tools,
  maxTokens: 16_000,
  additionalParams: {
    thinking: { type: "enabled", keep: "all" },
  },
});
```

Provider caveat: Moonshot rejects forced/specified `tool_choice` while thinking is
enabled. Let the model choose tools naturally when using Kimi thinking mode.

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

The package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath
types are available in a fresh worktree.

```sh
pnpm --filter @anvia/openai typecheck
pnpm --filter @anvia/openai test
pnpm --filter @anvia/openai build
```
