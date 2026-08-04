---
title: "@anvia/grok: Examples"
description: "Small examples that show @anvia/grok at the package boundary."
section: packages
sidebar:
  group: "@anvia/grok"
  order: 4
  label: "Examples"
---
## Minimal agent

```ts
import { AgentBuilder } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({ apiKey: process.env.XAI_API_KEY });
const agent = new AgentBuilder("support", client.completionModel())
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Draft a short support reply.").send();
console.log(response.output);
```
## Product-shaped model boundary

```ts
import type { CompletionModel } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

export function createSupportModel(): CompletionModel {
  const client = new GrokClient({ apiKey: process.env.XAI_API_KEY });
  return client.completionModel("grok-4.5");
}

export function createFallbackModel(): CompletionModel {
  const client = new GrokClient({ apiKey: process.env.XAI_API_KEY });
  return client.completionModel("grok-4.3");
}
```
The application can now choose a model before building the agent while keeping the agent factory provider-neutral.

## Live search with server tools

```ts
import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({ apiKey: process.env.XAI_API_KEY });

const agent = new AgentBuilder("researcher", grok.completionModel())
  .tools([
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.codeInterpreter(),
  ])
  .additionalParams({ max_turns: 5 })
  .build();

const result = await agent.prompt("What are the latest xAI updates?").send();
console.log(result.sources);
console.log(result.providerToolCalls);
```

## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("support model boundary", () => {
  it("creates a completion model", () => {
    const model = createSupportModel();

    expect(model).toHaveProperty("completion");
    expect(model).toHaveProperty("streamCompletion");
  });
});
```
Use live provider tests sparingly and gate them behind environment variables. Unit tests should usually check the model boundary and mock the model contract.