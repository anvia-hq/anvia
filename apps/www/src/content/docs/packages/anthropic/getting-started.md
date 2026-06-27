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

## Next step

Continue with [Usage Patterns](/docs/packages/anthropic/usage-patterns).
