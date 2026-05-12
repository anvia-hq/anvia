<p align="center">
  <img src="apps/docs/public/assets/logo.png" alt="Anvia logo" width="180" />
</p>

<h1 align="center">Anvia</h1>

<p align="center">
  <strong>Provider-agnostic agents, tool workflows, and structured extraction for TypeScript applications.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-89c83f?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/core-v0.2.1-2f80c7?style=flat-square" alt="@anvia/core v0.2.1" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/pnpm-11.0.4-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 11.0.4" />
  <img src="https://img.shields.io/badge/runtime-Node.js-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node.js runtime" />
  <img src="https://img.shields.io/badge/docs-cookbook-6f42c1?style=flat-square" alt="Cookbook docs" />
</p>

Anvia is a TypeScript runtime for building provider-agnostic agents, tool workflows, and structured extraction inside your application code.

It is designed for teams that want more structure than raw model calls, but less framework weight than a full orchestration stack. Provider clients create models. Builders configure behavior. Your application still owns data, permissions, persistence, and side effects.

## Product Shape

Anvia gives you a compact set of primitives for production-adjacent AI workflows:

- Agents, tools, extractors, pipelines, streaming, and typed output schemas.
- Provider-backed completion and embedding models across OpenAI, Anthropic, Gemini, Mistral, and compatible APIs.
- RAG primitives with in-memory search, local embeddings, ChromaDB, Qdrant, and pgvector adapters.
- Runtime integrations for MCP, local skills, multimodal attachments, observability, and Anvia Studio.

## When To Choose Anvia

Choose Anvia when you are building AI features inside a TypeScript product and want provider-agnostic agents, extractors, tools, pipelines, and Studio workflows without giving up control of your application's data, permissions, persistence, and side effects.

For deeper positioning, see [Comparison](apps/docs/content/docs/guides/comparison.mdx) and [Design Philosophy](apps/docs/content/docs/guides/design-philosophy.mdx).

## API Shape

```ts
import { AgentBuilder, ExtractorBuilder, PipelineBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey,
});
const model = client.completionModel("qwen/qwen3.6-35b-a3b");

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .build();

const response = await agent.prompt("How do I reset my password?").send();

const extractor = new ExtractorBuilder(model, ticketSchema).build();
const ticket = await extractor.extract(response.output);

const workflow = new PipelineBuilder<string>()
  .step((input) => `Summarize this support ticket:\n\n${input}`)
  .prompt(agent)
  .extract(extractor)
  .build();

const normalizedTicket = await workflow.run(
  "Acme Co. reports checkout failures. Priority is high.",
);
```

## Packages

| Package | Path | Purpose |
| --- | --- | --- |
| `@anvia/core` | `packages/core` | Core runtime for agents, tools, streaming, extraction, RAG primitives, MCP, skills, attachments, and observability interfaces. |
| `@anvia/openai` | `packages/providers/openai` | OpenAI and OpenAI-compatible provider adapter. |
| `@anvia/anthropic` | `packages/providers/anthropic` | Anthropic and Anthropic-compatible provider adapter. |
| `@anvia/gemini` | `packages/providers/gemini` | Gemini and Vertex AI provider adapter. |
| `@anvia/mistral` | `packages/providers/mistral` | Mistral completion and embedding provider adapter. |
| `@anvia/chroma` | `packages/vector-stores/chroma` | ChromaDB vector store adapter for Anvia embeddings and RAG. |
| `@anvia/qdrant` | `packages/vector-stores/qdrant` | Qdrant vector store adapter for Anvia embeddings and RAG. |
| `@anvia/pgvector` | `packages/vector-stores/pgvector` | Postgres pgvector store adapter for Anvia embeddings and RAG. |
| `@anvia/langfuse` | `packages/observability/langfuse` | Langfuse tracing adapter for Anvia observers. |
| `@anvia/otel` | `packages/observability/otel` | OpenTelemetry tracing adapter for Anvia observers. |
| `@anvia/transformers` | `packages/embeddings/transformers` | Transformers.js embedding model adapter, defaulting to local All-MiniLM. |
| `@anvia/studio` | `packages/tools/studio` | HTTP runtime and browser UI for serving agents, sessions, traces, pipelines, tools, MCPs, approvals, and knowledge inspection. |
| `docs` | `apps/docs` | Private documentation app. |
| `cookbook` | `examples/cookbook` | Runnable examples that document the public learning path. |

## Getting Started

Install dependencies:

```sh
pnpm install
```

Create a local `.env` file for cookbook runs:

```sh
OPENROUTER_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

Run the first basic text call:

```sh
pnpm cookbook:basics:01
```

Run Studio locally:

```sh
pnpm cookbook:studio:01
```

Start the cookbook ChromaDB service before running the Chroma-backed RAG examples:

```sh
docker compose -f examples/cookbook/compose.cookbook.yml up -d
pnpm cookbook:retrieval:05
pnpm cookbook:retrieval:06
pnpm cookbook:retrieval:07
pnpm cookbook:retrieval:08
```

## Cookbook

The cookbook is a product learning path. It starts with a plain text call, then adds history, streaming, tools, extraction, providers and multimodal APIs, pipelines, retrieval, multi-agent workflows, evals, Studio, and integrations one concept at a time.

| Level | Focus |
| --- | --- |
| Basics | Text calls, chat history, context, streaming, and `ReadableStream` output. |
| Tools | Tool calls, streamed tool events, hooks, concurrency, application state, guarded tools, and dynamic tool selection. |
| Structured output | Schema-first extraction, output schemas, context, retries, and extraction with history. |
| Providers and multimodal | Provider adapters, model capabilities, reasoning streams, attachments, image generation, audio generation, and transcription. |
| Pipelines | Step transforms, composition, named parallel branches, batching, agents, extraction, and richer workflows. |
| Retrieval | Local embeddings, vector search, metadata filters, RAG context, document loaders, ChromaDB, Qdrant, pgvector, FastEmbed, and Mistral embeddings. |
| Multi-agent | Agents as tools and pipeline-backed parallel specialists. |
| Evals | Deterministic metrics, semantic similarity, custom metrics, agent eval targets, and LLM judge/score. |
| Studio | Served agents, browser sessions, traces, pipeline inspection, multi-agent runners, tool approvals, human feedback, and Knowledge. |
| Integrations | MCP tools, local skills, Langfuse tracing, Langfuse eval reporting, and OpenTelemetry tracing. |

Run the default example for a level:

```sh
pnpm cookbook:basics
pnpm cookbook:tools
pnpm cookbook:structured-output
pnpm cookbook:providers
pnpm cookbook:pipelines
pnpm cookbook:retrieval
pnpm cookbook:multi-agent
pnpm cookbook:evals
pnpm cookbook:studio
pnpm cookbook:integrations
```

Numbered scripts are available for each level when you want to step through the path in order, for example `pnpm cookbook:basics:01`. Existing `basic`, `intermediate`, `pipeline`, `rag`, and `multimodal` cookbook scripts remain as compatibility aliases.

## Development

Install dependencies before running workspace tasks:

```sh
pnpm install
```

Common commands:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Package-scoped commands:

```sh
pnpm --filter @anvia/core typecheck
pnpm --filter @anvia/core test
pnpm --filter @anvia/core build

pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build

pnpm --filter cookbook typecheck
```

## Repository Layout

```txt
.
├── packages/
│   ├── core/                         # @anvia/core
│   ├── providers/
│   │   ├── openai/                   # @anvia/openai
│   │   ├── anthropic/                # @anvia/anthropic
│   │   ├── gemini/                   # @anvia/gemini
│   │   └── mistral/                  # @anvia/mistral
│   ├── vector-stores/
│   │   ├── chroma/                   # @anvia/chroma
│   │   ├── qdrant/                   # @anvia/qdrant
│   │   └── pgvector/                 # @anvia/pgvector
│   ├── observability/
│   │   ├── langfuse/                 # @anvia/langfuse
│   │   └── otel/                     # @anvia/otel
│   ├── embeddings/
│   │   ├── transformers/             # @anvia/transformers
│   │   └── fastembed/                # @anvia/fastembed
│   └── tools/
│       └── studio/                   # @anvia/studio
├── apps/
│   └── docs/         # documentation app
├── examples/
│   ├── cli-agent/    # runnable CLI agent example
│   └── cookbook/     # runnable examples
├── biome.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Contributing

Keep changes small and covered by the relevant package tests. For API changes, add or update cookbook coverage so the behavior is easy to verify from the command line.

Before opening a change, run:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## License

MIT.
