---
title: Stream completion
description: Stream normalized completion events from a model.
section: basics
sidebar:
  group: Runtime
  order: 4
---

Use `createCompletionStream` when you want direct model streaming before adding agent runtime events.

## When to use this

Stream direct completions when your UI or CLI should show text while the model is still generating, but you do not need tools, memory, or multi-turn agent behavior.

## Stream text

```ts
import { createCompletionStream } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");

for await (const event of createCompletionStream(model, {
  input: "Write a short launch note.",
})) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

## What happens

The stream yields normalized completion events from the provider model. The most common event for simple text output is `text_delta`.

This is lower level than agent streaming. Agent streams include runtime events such as tool calls, tool results, turns, and final run metadata.

## Next

Ask the model for schema-validated data.

[Structured output](/docs/basics/structured-output)
