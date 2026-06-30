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

const model = grok.completionModel("grok-4.3");

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

const model = grok.completionModel("grok-4.3");
```

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

The adapter maps the requested dimensions to xAI's `aspect_ratio` parameter and requests base64 image output when available. Provider-specific image options can be passed through `additionalParams`.

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
| Structured output schema | supported through the OpenAI-compatible completion adapters |
| Image input | supported when the selected xAI model supports it |
| Document input | supported by the Responses adapter when the selected xAI model supports it |
| Image generation | supported |
| Model listing | supported |
| Embeddings, audio, transcription, OCR, video, files, batches | not exposed by this package |

Read [Capability matrix](/docs/providers/capability-matrix) for a provider-by-provider comparison.
