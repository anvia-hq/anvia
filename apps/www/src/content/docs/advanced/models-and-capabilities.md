---
title: Models and capabilities
description: Choose models and handle provider capability differences.
section: advanced
sidebar:
  group: Production architecture
  order: 5
---

A model in Anvia is a reusable capability object. Provider packages create models from provider SDK clients, and `@anvia/core` sends normalized requests to those models.

Choose models by required capability, operational behavior, and provider constraints. Do not assume every model supports the same tools, streaming, structured output, images, documents, reasoning metadata, or media APIs.

## Provider Shape

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const model = client.completionModel("gpt-5.5");

export const supportAgent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .defaultMaxTurns(3)
  .build();
```

The provider client owns credentials and SDK setup. The model owns one provider capability. The agent owns runtime behavior around that model.

## Capability Checks

Before enabling a model in production, test the capabilities your workflow needs:

- streaming, if users should see progress
- tool calling, if the agent can call product actions
- structured output, if the response must match a schema
- image or document input, if prompts include non-text content
- provider-specific params, if you rely on reasoning, safety, or latency controls

These checks should run against the exact provider model id. A model family name is not specific enough. Providers can expose different behavior by version, account, region, endpoint, or compatibility layer.

## Smoke Tests

Keep provider smoke tests small and workflow-specific. A chat model test can send one direct completion. A tool model test should force a tool call and confirm the final answer uses the tool result. A structured-output test should intentionally parse the returned data. A streaming test should confirm both delta events and the final event arrive.

```ts
const result = await createCompletion(model, {
  input: "Reply with exactly: ready",
  maxTokens: 10,
});

if (result.text.trim().toLowerCase() !== "ready") {
  throw new Error("Model smoke test failed.");
}
```

Run smoke tests during deployment and when changing model ids. Use evals for quality, but keep smoke tests fast enough to catch configuration and capability failures early.

## Selection Defaults

Pin model ids in configuration for stable workflows. Use [Model listing](/docs/advanced/model-listing) for inventory, not as proof of feature support. If you add fallback models, verify tool calling, streaming, and schema behavior before the fallback can receive production traffic.

Run evals against every provider/model pair you plan to expose. Keep cost controls close to the runner by setting max tokens, turn limits, and workflow-specific timeouts.

For user-facing chat, latency and streaming behavior usually matter as much as raw answer quality. For extraction, schema reliability matters more. For background research, context length and cost may dominate. For eval judges, consistency matters more than creativity.

## Fallbacks

A fallback model is not just a backup string. It is another runtime configuration. If the primary model can call tools and stream events, the fallback must be tested with the same tools and stream handling. If the primary model supports structured output, the fallback must pass schema tests before it is safe.

Prefer explicit fallback policy in the runner. The retry decision should be application-owned because provider SDKs expose different error shapes:

```ts
try {
  return await primaryAgent.prompt(input).send();
} catch (error) {
  if (!retryPolicy.shouldRetry(error)) throw error;
  return fallbackAgent.prompt(input).maxTurns(2).send();
}
```

Do not silently fallback across providers when the workflow has side effects unless idempotency is handled outside the model loop.

## Multiple Providers

Multiple provider packages can coexist because `@anvia/core` is provider-neutral:

```ts
const supportModel = openai.completionModel("gpt-5.5");
const moderationModel = anthropic.completionModel("claude-sonnet");
```

Keep provider choice in configuration or model factories. Application workflows should depend on Anvia model interfaces, not directly on provider SDK calls.

## When To Split Models

Use separate models when workflows have different operational needs. A support chat may need low-latency streaming and tools. An extraction job needs reliable schema output. An eval runner needs consistent judging behavior. RAG indexing depends on embedding dimensions and batch behavior. Media workflows use image, audio, or transcription contracts instead of completion contracts.

Test the exact provider model id before enabling advanced features in production.
