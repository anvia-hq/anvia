---
title: "Core Reference"
description: "Public exports from @anvia/core and its subpaths."
section: packages
sidebar:
  group: "Reference"
  order: 1
  label: "Reference"
---
`@anvia/core` is the provider-neutral runtime package. The root entry point exposes the common app-authoring APIs. Advanced APIs live on focused subpaths.

## Import Paths

| Import path | Area |
| --- | --- |
| `@anvia/core` | Common app-authoring APIs for agents, tools, messages, hooks, skills, and errors |
| `@anvia/core/agent` | Agent builders, built-agent types, dynamic context/tool options, and event stores |
| `@anvia/core/hooks` | Prompt lifecycle hooks, hook controls, and hook helper functions |
| `@anvia/core/request` | Prompt requests, stream events, prompt responses, and prompt-run errors |
| `@anvia/core/completion` | Provider-facing completion messages, requests, responses, usage, and model contracts |
| `@anvia/core/image-generation` | Provider-neutral image generation contracts and request builders |
| `@anvia/core/audio-generation` | Provider-neutral audio generation contracts and request builders |
| `@anvia/core/transcription` | Provider-neutral audio transcription contracts and request builders |
| `@anvia/core/tool` | Tool definitions, registries, tool sets, serialization, and tool errors |
| `@anvia/core/pipeline` | Typed pipelines and batch execution |
| `@anvia/core/extractor` | Structured extraction helpers |
| `@anvia/core/evals` | Eval suites, metrics, agent targets, and reporters |
| `@anvia/core/loaders` | Node file and PDF loaders for ingestion preprocessing |
| `@anvia/core/embeddings` | Embedding models, documents, and vector math |
| `@anvia/core/model-listing` | Provider-neutral model listing contracts and errors |
| `@anvia/core/vector-store` | In-memory vector store, vector filters, and vector search tools |
| `@anvia/core/memory` | Durable session memory interfaces and in-memory session store |
| `@anvia/core/mcp` | MCP connection helpers and normalized MCP types |
| `@anvia/core/observability` | Observer interfaces, trace options, and score contracts |
| `@anvia/core/skills` | Skill loading, local skill discovery, validation, and generated skill tools |
| `@anvia/core/streaming` | Conversion from async iterables to web `ReadableStream` |
| `@anvia/core/internal/agent` | Unstable runtime agent internals for Anvia integration packages |

## Root Export Notes

The root `@anvia/core` export is the convenient application import path. Subpaths are required for advanced APIs and useful when packages need tighter import boundaries.

`@anvia/core/loaders` is subpath-only so normal core imports do not load Node filesystem and PDF extraction dependencies.

```ts
import { AgentBuilder, createTool, Message } from "@anvia/core";
import type { CompletionModel } from "@anvia/core/completion";
import type { AgentStreamEvent } from "@anvia/core/request";
```

For workflow guidance, start with [SDK Fundamentals](/docs/advanced/runtime-boundaries).
