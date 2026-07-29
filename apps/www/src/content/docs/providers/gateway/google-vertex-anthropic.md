---
title: "Vertex (Anthropic)"
description: "Review Vertex (Anthropic) connection details and model capabilities."
section: providers
sidebar:
  group: LLM Gateway
  order: 1127
  label: "Vertex (Anthropic)"
---

## Connection

| Field | Value |
| --- | --- |
| Anvia SDK | @anvia/anthropic |
| Compatibility | Anthropic on Vertex AI |
| API URL | Not listed in models.dev |
| Environment | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_VERTEX_PROJECT` |
| Provider docs | [https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude) |
| Models | 11 |

## Anvia Usage

This provider maps to `AnthropicVertexClient` in the Anvia Anthropic provider. Use the [Anthropic provider](/docs/providers/anthropic#vertex-ai) guide for authentication and production setup.

```ts
import { AnthropicVertexClient } from "@anvia/anthropic";

const client = new AnthropicVertexClient({
  projectId: process.env.GOOGLE_VERTEX_PROJECT,
  region: process.env.GOOGLE_VERTEX_LOCATION ?? "global",
});

const model = client.completionModel("claude-3-5-haiku@20241022");
```

## Capabilities

| Capability | Value |
| --- | --- |
| Input modalities | image, pdf, text |
| Output modalities | text |
| Attachments | 11 / 11 models |
| Tools | 11 / 11 models |
| Structured output | 0 / 11 models |
| Reasoning | 10 / 11 models |
| Temperature | 9 / 11 models |
| Open weights | 0 / 11 models |

## Models

| Model | Family | Input | Output | Capabilities | Limits | Cost | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-3-5-haiku@20241022`<br />Claude Haiku 3.5 | claude-haiku | image, pdf, text | text | tools, temperature | context: 200000 / output: 8192 | input: 0.8 / output: 4 / cache_read: 0.08 / cache_write: 1 | 2024-10-22 |
| `claude-haiku-4-5@20251001`<br />Claude Haiku 4.5 | claude-haiku | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 64000 | input: 1 / output: 5 / cache_read: 0.1 / cache_write: 1.25 | 2025-10-15 |
| `claude-opus-4-1@20250805`<br />Claude Opus 4.1 | claude-opus | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 32000 | input: 15 / output: 75 / cache_read: 1.5 / cache_write: 18.75 | 2025-08-05 |
| `claude-opus-4-5@20251101`<br />Claude Opus 4.5 | claude-opus | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 64000 | input: 5 / output: 25 / cache_read: 0.5 / cache_write: 6.25 | 2025-11-01 |
| `claude-opus-4-6@default`<br />Claude Opus 4.6 | claude-opus | image, pdf, text | text | tools, reasoning, temperature | context: 1000000 / output: 128000 | input: 5 / output: 25 / cache_read: 0.5 / cache_write: 6.25 | 2026-03-13 |
| `claude-opus-4-7@default`<br />Claude Opus 4.7 | claude-opus | image, pdf, text | text | tools, reasoning | context: 1000000 / output: 128000 | input: 5 / output: 25 / cache_read: 0.5 / cache_write: 6.25 | 2026-04-16 |
| `claude-opus-4-8@default`<br />Claude Opus 4.8 | claude-opus | image, pdf, text | text | tools, reasoning | context: 1000000 / output: 128000 | input: 5 / output: 25 / cache_read: 0.5 / cache_write: 6.25 | 2026-05-28 |
| `claude-opus-4@20250514`<br />Claude Opus 4 | claude-opus | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 32000 | input: 15 / output: 75 / cache_read: 1.5 / cache_write: 18.75 | 2025-05-22 |
| `claude-sonnet-4-5@20250929`<br />Claude Sonnet 4.5 | claude-sonnet | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 64000 | input: 3 / output: 15 / cache_read: 0.3 / cache_write: 3.75 | 2025-09-29 |
| `claude-sonnet-4-6@default`<br />Claude Sonnet 4.6 | claude-sonnet | image, pdf, text | text | tools, reasoning, temperature | context: 1000000 / output: 128000 | input: 3 / output: 15 / cache_read: 0.3 / cache_write: 3.75 | 2026-03-13 |
| `claude-sonnet-4@20250514`<br />Claude Sonnet 4 | claude-sonnet | image, pdf, text | text | tools, reasoning, temperature | context: 200000 / output: 64000 | input: 3 / output: 15 / cache_read: 0.3 / cache_write: 3.75 | 2025-05-22 |

Read [Gateway caveats](/docs/providers/gateway-caveats) before enabling this provider in production.
