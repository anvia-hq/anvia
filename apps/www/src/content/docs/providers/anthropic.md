---
title: Anthropic provider
description: Use @anvia/anthropic for Claude completion models.
section: providers
sidebar:
  group: Provider guides
  order: 20
---

`@anvia/anthropic` adapts Anthropic's SDK to Anvia completion and model-listing contracts. Use it when agents, extractors, or pipelines should run on Claude models through Anthropic.

## Install

```bash
pnpm add @anvia/core @anvia/anthropic
```

Create the client in server-only code:

```ts
import { AnthropicClient } from "@anvia/anthropic";

export const anthropic = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

`AnthropicClient` accepts `apiKey`, `baseUrl`, or an already-created Anthropic SDK `client`.

Use [Anthropic-Compatible](/docs/providers/anthropic-compatible) when you want to target a non-Anthropic endpoint through the Anvia Anthropic adapter.

## Completion Models

```ts
import { AgentBuilder } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const anthropic = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const model = anthropic.completionModel("claude-sonnet-4-20250514");

export const agent = new AgentBuilder("research", model)
  .instructions("Answer with concise citations when context is available.")
  .build();
```

`AnthropicCompletionModel` supports streaming, tools, tool choice, image input, document input, and reasoning content at the Anvia contract level. It does not declare support for core final output schemas, so avoid `createParsedCompletion(...)` or agent `.outputSchema(...)` workflows unless your target endpoint has been tested for that path. Core extractor workflows use a required `submit` tool instead of final output schemas, so smoke test the exact model for required tool calls when using Anthropic for extraction.

## Tools And Streaming

Anthropic tool calls map to Anvia assistant `tool_call` content and tool results map back to Anthropic `tool_result` blocks. The streaming adapter preserves tool input deltas so an agent can execute tools after streamed tool arguments arrive.

If a workflow relies on streamed tool arguments, include a provider smoke test that runs a required tool call and verifies the tool receives the complete input.

## Reasoning And History

The adapter preserves structured thinking and reasoning content in assistant history when Anthropic returns it. Treat that data as operational metadata. It can be useful for debugging and evals, but it may not be safe to show to users or persist without retention policy.

## Model Listing

```ts
const models = await anthropic.listModels();
```

Listing returns normalized model inventory when the upstream API supports it. Use it for admin visibility, not capability proof.

## Exports

The root package exports `AnthropicClient`, `AnthropicCompletionModel`, `AnthropicClientOptions`, and the `anthropic` namespace.
