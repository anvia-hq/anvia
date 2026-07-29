---
title: Anthropic provider
description: Use @anvia/anthropic for Claude through Anthropic or Google Vertex AI.
section: providers
sidebar:
  group: Provider guides
  order: 20
---

`@anvia/anthropic` adapts Anthropic's direct and Vertex AI SDKs to Anvia completion contracts. Use it when agents, extractors, or pipelines should run on Claude through Anthropic or Google Vertex AI.

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

## Vertex AI

Use `AnthropicVertexClient` for Claude on Google Vertex AI:

```ts
import { AnthropicVertexClient } from "@anvia/anthropic";

const vertexAnthropic = new AnthropicVertexClient({
  projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  region: process.env.CLOUD_ML_REGION ?? "global",
});

const model = vertexAnthropic.completionModel("claude-sonnet-5");
```

The client follows Google Application Default Credentials. For a service-account JSON file, set
`GOOGLE_APPLICATION_CREDENTIALS` in the server environment:

```sh
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
export ANTHROPIC_VERTEX_PROJECT_ID="my-gcp-project"
export CLOUD_ML_REGION="global"
```

`AnthropicVertexClientOptions` also accepts the official SDK's `googleAuth`, `authClient`,
`accessToken`, and transport options. Use a preconfigured `GoogleAuth` or `AuthClient` when the
application needs explicit credentials or service-account impersonation. Validate externally
supplied credential configuration before using it, and never commit credential JSON.

Vertex AI does not expose Anthropic's Models API, so `AnthropicVertexClient` intentionally has no
`listModels()` method.

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

Listing returns normalized model inventory from the direct Anthropic API. Use it for admin visibility, not capability proof.

## Exports

The root package exports `AnthropicClient`, `AnthropicVertexClient`, `AnthropicCompletionModel`,
their option and model-name types, and the `anthropic` namespace.
