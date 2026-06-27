---
title: "@anvia/mistral: Examples"
description: "Small examples that show @anvia/mistral at the package boundary."
section: packages
sidebar:
  group: "@anvia/mistral"
  order: 4
  label: "Examples"
---
## Minimal agent

```ts
import { AgentBuilder } from "@anvia/core";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });
const agent = new AgentBuilder("support", client.completionModel("mistral-large-latest"))
  .instructions("Answer support questions clearly.")
  .build();

const response = await agent.prompt("Draft a short support reply.").send();
console.log(response.output);
```
## Product-shaped model boundary

```ts
import type { CompletionModel } from "@anvia/core";
import { MistralClient } from "@anvia/mistral";

export function createSupportModel(): CompletionModel {
  const client = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });
  return client.completionModel("mistral-large-latest");
}

export function createFallbackModel(): CompletionModel {
  const client = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });
  return client.completionModel("mistral-large-latest");
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
