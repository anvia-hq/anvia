---
title: "xAI"
description: "Use xAI through @anvia/grok."
section: providers
sidebar:
  group: LLM Gateway
  order: 1132
  label: "xAI"
---

## Connection

| Field | Value |
| --- | --- |
| Anvia SDK | `@anvia/grok` |
| Compatibility | First-party xAI REST endpoint |
| API URL | `https://api.x.ai/v1` |
| Environment | `XAI_API_KEY` |
| Provider docs | [https://docs.x.ai/docs/models](https://docs.x.ai/docs/models) |
| Models | 8 |

## Anvia Usage

Use `GrokClient` from `@anvia/grok` for xAI completions, image generation, and model listing.

```ts
import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient } from "@anvia/grok";

const grok = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const model = grok.completionModel("grok-4.3");

export const agent = new AgentBuilder("grok-agent", model)
  .instructions("Answer clearly and concisely.")
  .build();
```

Read the [Grok provider guide](/docs/providers/grok) for package setup and supported surfaces.

## Capabilities

| Capability | Value |
| --- | --- |
| Input modalities | image, pdf, text, video |
| Output modalities | image, pdf, text, video |
| Attachments | 8 / 8 models |
| Tools | 4 / 8 models |
| Structured output | 5 / 8 models |
| Reasoning | 4 / 8 models |
| Temperature | 5 / 8 models |
| Open weights | 0 / 8 models |

## Models

| Model | Family | Input | Output | Capabilities | Limits | Cost | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `grok-4.20-0309-non-reasoning`<br />Grok 4.20 (Non-Reasoning) | grok | image, pdf, text | text | tools, schema, temperature | context: 1000000 / output: 30000 | input: 1.25 / output: 2.5 / cache_read: 0.2 | 2026-03-09 |
| `grok-4.20-0309-reasoning`<br />Grok 4.20 (Reasoning) | grok | image, pdf, text | text | tools, schema, reasoning, temperature | context: 1000000 / output: 30000 | input: 1.25 / output: 2.5 / cache_read: 0.2 | 2026-03-09 |
| `grok-4.20-multi-agent-0309`<br />Grok 4.20 Multi-Agent | grok | image, pdf, text | text | schema, reasoning, temperature | context: 1000000 / output: 30000 | input: 1.25 / output: 2.5 / cache_read: 0.2 | 2026-03-09 |
| `grok-4.3`<br />Grok 4.3 | grok | image, pdf, text | text | tools, schema, reasoning, temperature | context: 1000000 / output: 30000 | input: 1.25 / output: 2.5 / cache_read: 0.2 | 2026-04-17 |
| `grok-build-0.1`<br />Grok Build 0.1 | grok-build | image, pdf, text | text | tools, schema, reasoning, temperature | context: 256000 / output: 256000 | input: 1 / output: 2 / cache_read: 0.2 | 2026-04-16 |
| `grok-imagine-image`<br />Grok Imagine Image | grok | image, pdf, text | image, pdf | - | context: 8000 / output: 0 | - | 2026-01-28 |
| `grok-imagine-image-quality`<br />Grok Imagine Image Quality | grok | image, pdf, text | image, pdf | - | context: 8000 / output: 0 | - | 2026-04-03 |
| `grok-imagine-video`<br />Grok Imagine Video | grok | image, pdf, text, video | video | - | context: 1024 / output: 0 | - | 2026-01-28 |

Read [Gateway caveats](/docs/providers/gateway-caveats) before enabling this provider in production.
