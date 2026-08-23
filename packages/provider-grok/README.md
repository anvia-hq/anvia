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
import { Agent } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey,
});

const model = client.completionModel({ modelId: "grok-4.6", api: "responses" });

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.type === "response") console.log(result.output);
```

## Completion APIs

`GrokClient` targets `https://api.x.ai/v1` by default. Choose the protocol on each model handle:

```ts
const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});
```

Use the Chat Completions adapter when a workflow specifically needs that surface:

```ts
const chatModel = client.completionModel({ modelId: "grok-4.6", api: "chat" });
```

Provider-specific xAI parameters can be passed through completion `providerOptions`.

```ts
const response = await model.completion({
  chatHistory,
  documents: [],
  tools,
  providerOptions: {
    reasoning: { effort: "high" },
  },
});
```

## Live Search And Server Tools

Grok's Responses API can execute web search, X search, code interpreter, collections search, and
remote MCP tools on xAI's servers. Pass them through the same `.tools(...)` API as local executable
tools:

```ts
import { Agent } from "@anvia/core";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({ apiKey: process.env.XAI_API_KEY });

const researcher = new Agent({
  id: "researcher",
  model: grok.completionModel({ modelId: "grok-4.6", api: "responses" }),
  providerOptions: { max_turns: 5 },
  tools: [
    localDatabaseTool,
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
    grokTools.codeInterpreter(),
  ],
});

const result = await researcher.generate({ prompt: "Summarize the latest xAI updates." });

if (result.type === "response") {
  console.log(result.output);
  console.log(result.sources);
  console.log(result.providerToolCalls);
}
```

The Agent partitions tools internally: local tools remain in Anvia's executable tool runtime, while
Grok tools are sent to xAI and never executed locally. Server tools are supported by the Responses
adapter, not the Chat Completions adapter. Canonical local and typed provider tools take precedence
over a conflicting `providerOptions.tools` value.

Remote MCP authorization and headers are sent to xAI but omitted from Anvia's request trace
summary.

## Image Generation

```ts
import { generateImage } from "@anvia/core";
import { GROK_IMAGINE_IMAGE, GrokClient } from "@anvia/grok";

const client = new GrokClient({ apiKey });
const imageModel = client.imageGenerationModel({ modelId: GROK_IMAGINE_IMAGE });

const result = await generateImage({
  model: imageModel,
  prompt: "A compact robot drawing architecture diagrams on a glass wall.",
  width: 1024,
  height: 1024,
});

console.log(result.images[0].mediaType, result.images[0].data.byteLength);
```

The adapter requests base64 responses by default. If xAI returns image URLs, it fetches those URLs and returns bytes to satisfy Anvia's core image generation contract.
Exact xAI-supported aspect ratios are preserved; other width/height ratios map to `auto`. The
canonical `width` and `height` determine the aspect ratio even if `providerOptions.aspect_ratio`
is present.

## Batch Speech

```ts
import { generateSpeech, transcribe } from "@anvia/core";

const speech = await generateSpeech({
  model: client.speechGenerationModel(),
  text: "Hello from Grok.",
  voice: "eve",
  speed: 1,
  providerOptions: {
    language: "en",
    output_format: { codec: "mp3", sample_rate: 24_000 },
  },
});

const transcript = await transcribe({
  model: client.transcriptionModel(),
  audio: {
    data: speech.audio.data,
    filename: "speech.mp3",
    mediaType: speech.audio.mediaType,
  },
  language: "en",
});
```

These factories implement Anvia's batch `SpeechGenerationModel` and `TranscriptionModel` contracts.
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
- structural completion, image, speech, and transcription handle types
- Grok completion and image model-ID types
- typed `tools` factories for xAI server-executed tools
- model constants such as `GROK_4_6`, `GROK_4_20`, and `GROK_IMAGINE_IMAGE`
- `grok`

## Development

```sh
pnpm --filter @anvia/grok typecheck
pnpm --filter @anvia/grok test
pnpm --filter @anvia/grok build
```

Package-local `typecheck` and `build` scripts build `@anvia/openai` first so delegated adapter types are available in a fresh worktree. `@anvia/openai` builds `@anvia/core` when needed.
