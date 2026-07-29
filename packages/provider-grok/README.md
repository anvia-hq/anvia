# @anvia/grok

Grok provider adapter for Anvia.

Use this package when you want Anvia agents, live search, server-executed tools, batch speech,
image generation, or model listing to run on xAI APIs.

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

const model = client.completionModel(); // grok-4.5

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

## Live Search And Server Tools

Grok's Responses API can execute web search, X search, code interpreter, collections search, and
remote MCP tools on xAI's servers. Pass them through the same `.tools(...)` API as local executable
tools:

```ts
import { AgentBuilder } from "@anvia/core";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({ apiKey: process.env.XAI_API_KEY });

const researcher = new AgentBuilder("researcher", grok.completionModel())
  .tools([
    localDatabaseTool,
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
    grokTools.codeInterpreter(),
  ])
  .additionalParams({ max_turns: 5 })
  .build();

const result = await researcher.prompt("Summarize the latest xAI updates.").send();

console.log(result.output);
console.log(result.sources);
console.log(result.providerToolCalls);
```

The builder partitions tools internally: local tools remain in Anvia's executable `ToolSet`, while
Grok tools are sent to xAI and never executed locally. Server tools are supported by the Responses
adapter, not the Chat Completions adapter. Legacy raw `additionalParams.tools` arrays are merged
after local and typed provider tools.

Remote MCP authorization and headers are sent to xAI but omitted from Anvia's request trace
summary.

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
Exact xAI-supported aspect ratios are preserved; other width/height ratios map to `auto`. An
explicit `additionalParams.aspect_ratio` takes precedence.

## Batch Speech

```ts
const speech = await client.audioGenerationModel().audioGeneration({
  text: "Hello from Grok.",
  voice: "eve",
  speed: 1,
  additionalParams: {
    language: "en",
    output_format: { codec: "mp3", sample_rate: 24_000 },
  },
});

const transcript = await client.transcriptionModel().transcription({
  data: speech.audio,
  filename: "speech.mp3",
  language: "en",
});
```

These factories implement Anvia's batch `AudioGenerationModel` and `TranscriptionModel` contracts.
Realtime voice and streaming speech are not included.

## Model Listing

```ts
const models = await client.listModels();
```

Use listing for inventory. Keep a separate app allowlist for production-enabled model ids.

## Unsupported xAI Surfaces

This package does not currently expose image editing, video generation, realtime voice, streaming
speech, file or collection management, batches, stored completions, compaction, or telemetry.

## Exports

- `GrokClient`
- `GrokResponsesCompletionModel`
- `GrokChatCompletionModel`
- `GrokImageGenerationModel`
- `GrokAudioGenerationModel`
- `GrokTranscriptionModel`
- typed `tools` factories for xAI server-executed tools
- model constants such as `GROK_4_5`, `GROK_4_20`, and `GROK_IMAGINE_IMAGE`
- `grok`

## Development

```sh
pnpm --filter @anvia/grok typecheck
pnpm --filter @anvia/grok test
pnpm --filter @anvia/grok build
```

Package-local `typecheck` and `build` scripts build `@anvia/openai` first so delegated adapter types are available in a fresh worktree. `@anvia/openai` builds `@anvia/core` when needed.
