---
title: "@anvia/anthropic: Examples"
description: "Small examples that show @anvia/anthropic at the package boundary."
section: packages
sidebar:
  group: "@anvia/anthropic"
  order: 4
  label: "Examples"
---
## Minimal agent

```ts
import { AgentBuilder } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
const agent = new AgentBuilder("support", client.completionModel("claude-sonnet-4-20250514"))
  .instructions("Answer support questions clearly.")
  .build();

const response = await agent.prompt("Draft a short support reply.").send();
console.log(response.output);
```
## Product-shaped model boundary

```ts
import type { CompletionModel } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

export function createSupportModel(): CompletionModel {
  const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.completionModel("claude-sonnet-4-20250514");
}

export function createFallbackModel(): CompletionModel {
  const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.completionModel("claude-sonnet-4-20250514");
}
```
The application can now choose a model before building the agent while keeping the agent factory provider-neutral.

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
