---
title: Providers overview
description: Connect Anvia's provider-neutral runtime to OpenAI, Anthropic, Gemini, Mistral, and Grok.
section: providers
sidebar:
  group: Getting started
  order: 1
---

Provider packages turn vendor SDKs into Anvia model objects. `@anvia/core` owns the runtime contracts for completions, tools, streaming, embeddings, media generation, transcription, and model listing. A provider package owns credentials, SDK setup, request mapping, response mapping, and provider-specific options.

The current provider packages are:

| Package | Main client | Primary use |
| --- | --- | --- |
| `@anvia/openai` | `OpenAIClient` | OpenAI completions, embeddings, image generation, audio generation, transcription, and model listing |
| `@anvia/anthropic` | `AnthropicClient` | Claude completions through Anthropic |
| `@anvia/gemini` | `GeminiClient` | Gemini API and Vertex AI completions, embeddings, image generation, transcription, and model listing |
| `@anvia/mistral` | `MistralClient` | Mistral completions, embeddings, OCR, and model listing |
| `@anvia/grok` | `GrokClient` | xAI Grok completions, image generation, and model listing |

## Install Shape

Install `@anvia/core` plus the provider package your app needs:

```bash
pnpm add @anvia/core @anvia/openai
```

Add more providers only when a workflow actually needs them:

```bash
pnpm add @anvia/anthropic @anvia/gemini @anvia/mistral @anvia/grok
```

Most applications should keep provider clients in server-only modules. Browser code should call your product API or stream endpoint, not a provider SDK.

## Client To Model To Agent

The common shape is client, model, agent:

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const openai = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = openai.completionModel("gpt-5");

export const supportAgent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .defaultMaxTurns(3)
  .build();
```

The client owns credentials and endpoint configuration. The model owns one provider capability. The agent owns runtime behavior such as instructions, tools, hooks, memory, observers, limits, and streaming.

## Multiple Providers

You can use several provider packages in the same app because agents depend on core model interfaces, not provider SDKs:

```ts
const chatModel = openai.completionModel(process.env.SUPPORT_MODEL);
const judgeModel = anthropic.completionModel(process.env.EVAL_MODEL);
const embeddingModel = gemini.embeddingModel("gemini-embedding-001");
```

Keep provider choice in configuration or model factories. Application workflows should receive model objects rather than constructing provider clients inside route handlers, UI code, or tool handlers.

## Provider Capabilities

Provider packages expose different model factories because vendors expose different APIs. For example, OpenAI exposes audio generation, Gemini exposes both Gemini-native image generation and Imagen, Mistral exposes OCR, and Grok exposes xAI image generation. Anthropic currently exposes completion and model listing only.

Read [Capability matrix](/docs/providers/capability-matrix) before assuming a provider supports a workflow. Then test the exact model id you plan to run in production.

For compatible API surfaces, read [OpenAI-Compatible](/docs/providers/openai-compatible) or [Anthropic-Compatible](/docs/providers/anthropic-compatible).

## Safe Defaults

- Store provider keys in deployment secrets.
- Validate model ids and endpoint URLs at startup.
- Keep provider SDKs on the server or in workers.
- Use exact model ids in config, evals, and smoke tests.
- Treat provider-specific `additionalParams` as app config when they affect product behavior.
- Do not assume fallback providers support the same tools, streaming, schemas, or media inputs.

Read [Models and capabilities](/docs/advanced/models-and-capabilities) for production model selection and [Configuration](/docs/advanced/configuration) for factory patterns.
