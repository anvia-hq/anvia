# Anvia

Anvia is a TypeScript runtime for building provider-agnostic agents, tool workflows, and structured extraction inside your application code.

It is designed for teams that want more structure than raw model calls, but less framework weight than a full orchestration stack. Provider clients create models. Builders configure behavior. Your application still owns data, permissions, persistence, and side effects.

## Product Shape

Anvia gives you a compact set of primitives for production-adjacent AI workflows:

- Build agents with instructions, tools, context, history, streaming, hooks, turn limits, and output schemas.
- Compose reusable pipelines with explicit steps, named parallel branches, agent prompts, extraction, and batched runs.
- Create provider-backed completion and embedding models for OpenAI, OpenAI-compatible APIs, Anthropic, Anthropic-compatible APIs, Gemini, and Vertex AI.
- Define tools with Zod schemas, runtime validation, optional output validation, and concurrency controls.
- Extract structured data with schema-first extractors built from reusable completion models.
- Stream normalized events or expose newline-delimited JSON through `ReadableStream`.
- Add RAG with local All-MiniLM embeddings, in-memory vector search, metadata filters, dynamic context, and ChromaDB.
- Add Postgres-backed RAG through pgvector when you want embeddings beside application data.
- Connect MCP servers, local skills, image inputs, and document/PDF attachments where the provider supports them.
- Observe runs through a generic observer interface, with optional Langfuse or OpenTelemetry tracing.
- Serve agents locally with Anvia Studio for chat, traces, sessions, and tool approval workflows.

## When To Choose Anvia

Choose Anvia when you are building AI features inside a TypeScript product and want provider-agnostic agents, extractors, tools, pipelines, and Studio workflows without giving up control of your application's data, permissions, persistence, and side effects.

Anvia is strongest when you need:

- Application-owned agent infrastructure that can move across providers and runtime environments.
- Typed tools and structured extraction with runtime validation.
- Explicit model, agent, extractor, and pipeline boundaries that stay easy to test.
- Local development workflows for trying agents, inspecting traces, managing sessions, and approving tools.
- A cookbook-first path from simple calls to production-adjacent workflows.

Anvia is less focused today on one-off raw completion calls, fully visual no-code workflow design, or hiding provider and runtime choices behind a large abstraction layer. The core SDK is designed so hosted execution can build on portable primitives later without changing the ownership model.

## Comparison

Use Anvia when you want provider-neutral AI features inside your own TypeScript app. Use broader frameworks when you want more platform-managed surface. Use provider-native SDKs when your product is centered on one provider's agent runtime.

The full comparison lives in [Comparison](apps/docs/content/docs/guides/comparison.mdx).

## Design Philosophy

Anvia is designed as a small runtime library, not a full application platform. AI features should be ordinary TypeScript objects that your application creates, configures, tests, and passes around. Anvia owns the model-facing runtime behavior. Your application owns product behavior.

| Design choice | Advantage | Tradeoff |
| --- | --- | --- |
| Stable built objects | Easier testing, sharing, and reasoning | You wire objects explicitly |
| Application-owned infrastructure | Better fit for existing products and security boundaries | Less automatic platform behavior |
| Provider-neutral models | Easier provider switching and mixed-provider systems | Some provider-native features stay behind adapters |
| Typed tools, extractors, and pipelines | Clear contracts and safer composition | More upfront schema definition |
| Optional integrations | Smaller core and incremental adoption | You choose and configure the integrations you need |

The full rationale lives in [Design Philosophy](apps/docs/content/docs/guides/design-philosophy.mdx).

## Design Position

Anvia sits between provider-first agent SDKs and larger orchestration frameworks such as LangChain.

Provider-first SDKs are convenient when the provider runtime owns the workflow. Large orchestration frameworks are powerful when you need many abstractions for chains, graphs, memory, retrievers, callbacks, and execution policies. Anvia keeps the core model smaller: it gives you explicit runtime objects that compose with ordinary TypeScript.

The main boundary is deliberate:

- `client` is provider access: API keys, base URLs, and provider-specific model wiring.
- `completionModel(...)` is a reusable model capability.
- `AgentBuilder` configures agent behavior around a stable runtime `id`.
- `ExtractorBuilder` configures schema-first extraction without a public extractor id.
- `PipelineBuilder` composes application steps, named parallel branches, agents, and extractors into runnable workflows.
- `Agent` identity is stable for Studio, tracing, and multi-agent registration. Optional `name` and `description` remain display metadata.

This keeps common workflows concise while making the important boundaries visible.

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
| `@anvia/studio` | `packages/tools/studio` | HTTP runtime and browser UI for serving agents, sessions, traces, and approvals. |
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
| Studio | Served agents, browser sessions, traces, multi-agent runners, tool approvals, human feedback, and Knowledge. |
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
│   │   └── langfuse/                 # @anvia/langfuse
│   ├── embeddings/
│   │   └── transformers/             # @anvia/transformers
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
