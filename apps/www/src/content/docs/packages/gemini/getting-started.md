---
title: "@anvia/gemini: Getting Started"
description: "Install @anvia/gemini and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/gemini"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/gemini @anvia/core
```
## Configure credentials

Set `GEMINI_API_KEY` in the server environment. Keep provider keys on the server side; browser clients should call an application route that owns the model request.
For Vertex AI, construct `GeminiClient` with `vertexai: true`, `project`, and `location` instead of an API key.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});

const model = client.completionModel("gemini-2.5-flash");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize this ticket.").send();
console.log(response.output);
```


## Other model factories

@anvia/gemini also exposes an embedding model factory:
```ts
const embeddings = client.embeddingModel("gemini-embedding-001");
const vectors = await embeddings.embedTexts(["Refunds take five business days."]);
```

## Next step

Continue with [Usage Patterns](/docs/packages/gemini/usage-patterns).
