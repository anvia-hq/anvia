---
title: Grok provider
description: Use xAI Grok models through Anvia's provider-neutral runtime.
section: providers
sidebar:
  group: Provider guides
  order: 50
---

`@anvia/grok` connects Anvia agents to xAI's first-party REST API. It defaults to the Responses API shape and also exposes a Chat Completions adapter for compatible workflows.

## Install

```bash
pnpm add @anvia/core @anvia/grok
```

Set your xAI API key in server-side configuration:

```bash
XAI_API_KEY=...
```

## Client Setup

```ts
import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient } from "@anvia/grok";

const grok = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const model = grok.completionModel(); // defaults to grok-4.5

export const agent = new AgentBuilder("grok-agent", model)
  .instructions("Answer clearly and concisely.")
  .build();
```

`completionModel()` uses the Responses adapter by default. Use the Chat Completions adapter when a workflow needs that API shape:

```ts
const grok = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
  completionApi: "chat",
});

const model = grok.completionModel("grok-4.5");
```

## Live Search And Server Tools

The Responses adapter supports xAI's web search, X search, code interpreter, collections search,
and remote MCP tools:

```ts
import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({ apiKey: process.env.XAI_API_KEY });

const agent = new AgentBuilder("researcher", grok.completionModel())
  .tools([
    localDatabaseTool,
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
    grokTools.codeInterpreter(),
  ])
  .additionalParams({ max_turns: 5 })
  .build();

const result = await agent.prompt("What are the latest xAI updates?").send();

console.log(result.sources);
console.log(result.providerToolCalls);
```

`.tools(...)` accepts local executable tools and provider-executed tools in one array. Anvia keeps
the local tools in its `ToolSet` and sends the Grok tools only to xAI. Sources and provider tool
status are available on completion responses, agent results, agent streams, and generated
assistant-message metadata.

Typed server tools require the Responses adapter. The Chat Completions adapter rejects them.

## Image Generation

The provider exposes xAI image generation through Anvia's `ImageGenerationModel` contract:

```ts
const imageModel = grok.imageGenerationModel("grok-imagine-image");

const result = await imageModel.imageGeneration({
  prompt: "A clean product render of a small desk lamp",
  width: 1024,
  height: 1024,
});
```

The adapter maps exact supported dimensions to xAI's `aspect_ratio` parameter and uses `auto` for
unsupported ratios. Provider-specific image options can be passed through `additionalParams`; an
explicit `additionalParams.aspect_ratio` wins.

## Batch Audio And Transcription

```ts
const audio = await grok.audioGenerationModel().audioGeneration({
  text: "Hello from Grok.",
  voice: "eve",
  speed: 1,
  additionalParams: { language: "en" },
});

const transcript = await grok.transcriptionModel().transcription({
  data: audio.audio,
  filename: "speech.mp3",
  language: "en",
});
```

The adapter covers batch TTS and STT through Anvia's existing core contracts. It does not expose
xAI's realtime voice or streaming speech APIs.

## Model Listing

`GrokClient` implements `ModelListingClient`:

```ts
const models = await grok.listModels();
```

Use model listing for inventory and startup checks. Still smoke test the exact model id and capability your workflow depends on.

## Supported Surfaces

| Surface | Status |
| --- | --- |
| Text completion | supported |
| Streaming completion | supported |
| Tools and tool choice | supported through the OpenAI-compatible completion adapters |
| Server-executed tools | web search, X search, code interpreter, file search, and remote MCP through Responses |
| Citations | normalized final sources and stream events |
| Structured output schema | supported through the OpenAI-compatible completion adapters |
| Image input | supported when the selected xAI model supports it |
| Document input | supported by the Responses adapter when the selected xAI model supports it |
| Image generation | supported |
| Audio generation | supported through batch TTS |
| Transcription | supported through batch STT |
| Model listing | supported |
| Embeddings, OCR, video, file management, collection management, batches | not exposed by this package |

Read [Capability matrix](/docs/providers/capability-matrix) for a provider-by-provider comparison.
