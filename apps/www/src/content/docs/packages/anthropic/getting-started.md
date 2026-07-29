---
title: "@anvia/anthropic: Getting Started"
description: "Install @anvia/anthropic and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/anthropic"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/anthropic @anvia/core
```
## Configure credentials

Set `ANTHROPIC_API_KEY` in the server environment. Keep provider keys on the server side; browser clients should call an application route that owns the model request.

For Vertex AI, use `AnthropicVertexClient` with Google Application Default Credentials. Set
`GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_VERTEX_PROJECT_ID`, and `CLOUD_ML_REGION`, or pass the
official Vertex SDK authentication options explicitly.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const model = client.completionModel("claude-sonnet-4-20250514");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize this ticket.").send();
console.log(response.output);
```

## Vertex AI setup

```ts
import { AnthropicVertexClient } from "@anvia/anthropic";

const client = new AnthropicVertexClient({
  projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  region: process.env.CLOUD_ML_REGION ?? "global",
});

const model = client.completionModel("claude-sonnet-5");
```

`AnthropicVertexClient` supports completions and streaming, but not model listing because Vertex AI
does not expose Anthropic's Models API.

## Next step

Continue with [Usage Patterns](/docs/packages/anthropic/usage-patterns).
