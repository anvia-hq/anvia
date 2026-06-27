---
title: "@anvia/core: Getting Started"
description: "Install @anvia/core and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/core"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/core
```

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const model = client.completionModel("gpt-5");

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .defaultMaxTurns(4)
  .build();

const response = await agent.prompt("Draft a reply to this ticket.").send();
console.log(response.output);
```
## Next step

Continue with [Usage Patterns](/docs/packages/core/usage-patterns).
