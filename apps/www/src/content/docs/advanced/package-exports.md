---
title: Package exports
description: Map @anvia/core root imports and subpath exports to their feature areas.
section: advanced
sidebar:
  group: Production architecture
  order: 2
---

`@anvia/core` publishes a small root entry point plus focused subpaths. The root import is the convenient app-authoring surface. Subpaths are for advanced APIs, package boundaries, and integration code that should not import more of core than it needs.

The package is ESM-only and builds JavaScript plus type declarations for every exported entry point. That means application code can use the root import while libraries, adapters, and larger codebases can depend on narrower subpaths.

## Root Import

Use the root import in routes, runners, tests, examples, and small applications:

```ts
import {
  AgentBuilder,
  Message,
  createCompletion,
  createTool,
  createThinkTool,
  loadSkills,
} from "@anvia/core";
```

This surface covers the common authoring path: build an agent, send direct completions, create messages, define tools, attach middleware and hooks, load skills, and use shared core types. It is the right default when the module is product code and not an integration package.

## Subpath Imports

Use subpaths when the module has a specific responsibility. For example, a vector-store adapter should import vector types, not the whole agent builder surface. A browser-facing transport module should avoid Node-only loader imports. A provider package should depend on completion contracts, not app helpers.

| Import path | Use for |
| --- | --- |
| `@anvia/core/agent` | agent builders, built-agent types, dynamic context/tool options, event stores |
| `@anvia/core/hooks` | prompt lifecycle hooks, hook controls, hook helpers |
| `@anvia/core/request` | prompt requests, stream events, responses, prompt errors |
| `@anvia/core/completion` | messages, content parts, direct completions, model contracts |
| `@anvia/core/tool` | tool sets, dynamic tools, serialization, tool errors |
| `@anvia/core/memory` | durable session memory interfaces |
| `@anvia/core/pipeline` | typed pipelines, graphs, observers, batch execution |
| `@anvia/core/extractor` | schema-first structured extraction |
| `@anvia/core/evals` | eval suites, metrics, reporters, agent eval targets |
| `@anvia/core/embeddings` | embedding contracts, document embedding, vector math |
| `@anvia/core/vector-store` | in-memory vector store, filters, search tools |
| `@anvia/core/loaders` | file and PDF loaders for ingestion |
| `@anvia/core/mcp` | MCP connections and MCP tool adaptation |
| `@anvia/core/observability` | observer interfaces, traces, generation and tool events |
| `@anvia/core/skills` | skill loading, local skills, validation |
| `@anvia/core/streaming` | async iterable to web `ReadableStream` conversion |
| `@anvia/core/model-listing` | provider-neutral model inventory contracts |
| `@anvia/core/image-generation` | provider-neutral image generation contracts |
| `@anvia/core/audio-generation` | provider-neutral audio generation contracts |
| `@anvia/core/transcription` | provider-neutral audio transcription contracts |

## Import Boundaries In Practice

App runners can stay broad:

```ts
import { AgentBuilder, Message, createTool } from "@anvia/core";
```

Integration code should stay narrow:

```ts
import type { CompletionModel, CompletionRequest } from "@anvia/core/completion";
import type { AgentStreamEvent } from "@anvia/core/request";
import type { VectorSearchIndex } from "@anvia/core/vector-store";
```

Narrow imports make package intent clearer. They also avoid accidental coupling to APIs that are convenient in applications but wrong in reusable adapters.

## Internal Exports

`@anvia/core/internal/agent` exists for Anvia integration packages that need lower-level runtime internals. Treat it as unstable. Application code should prefer the root import or `@anvia/core/agent`.

If you are unsure which path to use, start with the root import in app code and switch to subpaths when a module becomes reusable, shared, browser-facing, or adapter-like.

## What Belongs In App Code

Application code can usually stay with the root import because it is close to the workflow being run. A support route, queue worker, or test harness benefits from readability more than strict import minimalism.

Reusable packages should be stricter. A logger adapter should not import `AgentBuilder`. A vector adapter should not import completion helpers. A browser transport should not import loaders. These boundaries keep optional dependencies predictable and make it easier for downstream apps to install only what they need.

This is also why `@anvia/core/loaders` is a subpath. File and PDF loading are useful for ingestion, but they are not needed by every agent route. Keeping them behind an explicit import makes server-only usage easier to see during review.
