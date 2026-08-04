---
title: "@anvia/grok: Getting Started"
description: "Install @anvia/grok and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/grok"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/grok @anvia/core
```
## Configure credentials

Set `XAI_API_KEY` in the server environment. Keep provider keys on the server side; browser clients should call an application route that owns the model request.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const model = client.completionModel(); // defaults to grok-4.5

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize this ticket.").send();
console.log(response.output);
```

`completionModel()` uses the Responses adapter by default. Use the Chat Completions adapter when a workflow needs that API shape:

```ts
const chatClient = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
  completionApi: "chat",
});

const model = chatClient.completionModel("grok-4.5");
```

## Other model factories

@anvia/grok also exposes image generation, batch speech, and transcription factories:

```ts
const imageModel = client.imageGenerationModel("grok-imagine-image");
const speech = await client.audioGenerationModel().audioGeneration({
  text: "Hello from Grok.",
  voice: "eve",
  speed: 1,
});
const transcript = await client.transcriptionModel().transcription({
  data: speech.audio,
  filename: "speech.mp3",
  language: "en",
});
```

## Next step

Continue with [Usage Patterns](/docs/packages/grok/usage-patterns).