---
title: "@anvia/gemini: Examples"
description: "Small examples that show @anvia/gemini at the package boundary."
section: packages
sidebar:
  group: "@anvia/gemini"
  order: 4
  label: "Examples"
---
## Minimal agent

```ts
import { AgentBuilder } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY });
const agent = new AgentBuilder("support", client.completionModel("gemini-2.5-flash"))
  .instructions("Answer support questions clearly.")
  .build();

const response = await agent.prompt("Draft a short support reply.").send();
console.log(response.output);
```
## Product-shaped model boundary

```ts
import type { CompletionModel } from "@anvia/core";
import { GeminiClient } from "@anvia/gemini";

export function createSupportModel(): CompletionModel {
  const client = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY });
  return client.completionModel("gemini-2.5-flash");
}

export function createFallbackModel(): CompletionModel {
  const client = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY });
  return client.completionModel("gemini-2.5-flash");
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
