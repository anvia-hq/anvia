---
title: Overview
description: Understand the basic Anvia runtime path before adding advanced features.
section: basics
sidebar:
  group: Runtime
  order: 1
---

Anvia is built from small runtime pieces. Start with a provider-neutral model call, then add agent behavior when you need instructions, turns, tools, memory, or app streaming.

## Learning path

Basics is ordered from the smallest runtime primitive to the product-facing runtime pieces:

1. **Install**: add `@anvia/core` and one provider package.
2. **Complete**: call a model directly with `createCompletion`.
3. **Stream**: stream one model call with `createCompletionStream`.
4. **Structure**: ask for validated data with `createParsedCompletion`.
5. **Agent**: wrap the model with `AgentBuilder` when you need runtime behavior.
6. **Extend**: add tools, memory, context, server streams, React state, logging, sandbox tools, and Studio.

Completion comes before agents because agents are built on top of model calls.

## Runtime layers

`@anvia/core` contains provider-neutral primitives: completions, agents, tools, memory, streaming events, and context.

Provider packages such as `@anvia/openai` create models that implement the core interfaces. App packages such as `@anvia/server`, `@anvia/react`, and `@anvia/logger` connect runtime output to product surfaces. Tooling packages such as `@anvia/sandbox` and `@anvia/studio` help you run and inspect agents during development.

## Basic stack

Most examples in Basics use OpenAI as the first provider:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");
```

After you have a model, every runtime feature builds from there.

## Next

Install the packages for the smallest useful runtime stack.

[Install packages](/docs/basics/install-packages)
