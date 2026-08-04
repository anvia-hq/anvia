---
title: "@anvia/grok: Usage Patterns"
description: "Common ways to compose @anvia/grok with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/grok"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

@anvia/grok owns the provider adapter. It should be created at the model boundary, then passed into `@anvia/core` as a completion, image generation, audio generation, transcription, or listing model where that package supports it.

Keep prompts, tools, memory, retrieval, tenant routing, and fallback policy outside the provider adapter. That makes it possible to swap providers without rewriting agent or pipeline code.

## Server-executed tools

The Responses adapter can execute web search, X search, code interpreter, collections search, and remote MCP tools on xAI's servers. Pass them through the same `.tools(...)` API as local executable tools:

```ts
import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({ apiKey: process.env.XAI_API_KEY });

const agent = new AgentBuilder("researcher", grok.completionModel())
  .tools([
    localDatabaseTool,
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
    grokTools.codeInterpreter(),
  ])
  .additionalParams({ max_turns: 5 })
  .build();
```

Anvia keeps local tools in its executable `ToolSet` and sends Grok tools only to xAI. Typed server tools require the Responses adapter; the Chat Completions adapter rejects them.

## Common composition

- Pair with `@anvia/core` for agents, direct completions, extractors, and pipelines.
- Pair with `@anvia/server` and `@anvia/react` when exposing streamed runs to a browser UI.
- Pair with `@anvia/logger`, `@anvia/langfuse`, or `@anvia/otel` when provider calls need operational visibility.
- Pair provider embeddings with a vector-store package for RAG ingestion and search.

## Do and do not

Do construct `GrokClient` once per runtime boundary or request scope. Do record selected provider and model in logs or traces. Do pass provider-specific options through the model request only when the behavior is intentionally provider-specific.

Do not import provider SDK types throughout product code. Do not put API keys in browser bundles. Do not hide fallback behavior inside the agent prompt; make model selection explicit and testable.