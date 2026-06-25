---
title: Build your first agent
description: Wrap model calls in an agent with instructions and runtime behavior.
section: basics
sidebar:
  group: Runtime
  order: 6
home:
  card: true
  order: 2
---

Agents build on top of model calls. Use an agent when you want repeatable runtime behavior around a model: instructions, turn limits, tools, memory, context, streaming, and observers.

## When to use this

Use an agent when the same model behavior is reused across product requests. For a one-off model call, use direct completion first.

## Build an agent

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly and ask for missing details.")
  .defaultMaxTurns(4)
  .build();
```

## What happens

`AgentBuilder` stores runtime behavior around the model. The agent is still provider-neutral because it depends on the model interface, not directly on OpenAI-specific APIs.

`defaultMaxTurns(4)` limits how many model/tool turns a request can take. This matters later when tools are attached.

## Next

Send a prompt through the agent.

[Send a prompt](/docs/basics/send-a-prompt)
