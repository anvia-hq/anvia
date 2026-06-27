---
title: "@anvia/mistral: Getting Started"
description: "Install @anvia/mistral and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/mistral"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/mistral @anvia/core
```
## Configure credentials

Set `MISTRAL_API_KEY` in the server environment. Keep provider keys on the server side; browser clients should call an application route that owns the model request.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({
  apiKey: process.env.MISTRAL_API_KEY,
});

const model = client.completionModel("mistral-large-latest");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize this ticket.").send();
console.log(response.output);
```


## Other model factories

@anvia/mistral also exposes an embedding model factory:
```ts
const embeddings = client.embeddingModel("mistral-embed");
const vectors = await embeddings.embedTexts(["Refunds take five business days."]);
```


Mistral also exposes OCR through `client.ocrModel()` for document inputs handled outside the chat model path.

## Next step

Continue with [Usage Patterns](/docs/packages/mistral/usage-patterns).
