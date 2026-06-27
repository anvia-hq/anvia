---
title: "@anvia/openai: Getting Started"
description: "Install @anvia/openai and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/openai"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/openai @anvia/core
```
## Configure credentials

Set `OPENAI_API_KEY` in the server environment. Keep provider keys on the server side; browser clients should call an application route that owns the model request.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize this ticket.").send();
console.log(response.output);
```


## Other model factories

@anvia/openai also exposes an embedding model factory:
```ts
const embeddings = client.embeddingModel("text-embedding-3-small");
const vectors = await embeddings.embedTexts(["Refunds take five business days."]);
```

## Next step

Continue with [Usage Patterns](/docs/packages/openai/usage-patterns).
