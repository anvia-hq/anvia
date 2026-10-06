<p align="center">
  <img src=".github/assets/anvia-wordmark.png" alt="Anvia wordmark" width="320" />
</p>

<p align="center">
  <strong>Build with Anvia. Own everything.</strong>
</p>

<p align="center">
  The complete agent stack, without giving up your stack.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-89c83f?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/runtime-Node.js-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node.js runtime" />
</p>

Anvia is an open, TypeScript agent stack that gives developers everything they need to build production agents — without taking ownership of their stack.

Your application stays the system of record: it creates the provider models, typed tools, memory stores, and observers, and passes them into Anvia agents and runners. Anvia runs the model/tool loop — remove it and you keep your product.

<p align="center">
  <a href="https://github.com/anvia-hq/lens"><picture><source media="(prefers-color-scheme: dark)" srcset=".github/assets/lens-banner.svg" /><img src=".github/assets/lens-banner-light.svg" alt="Anvia Lens — self-hosted observability and evaluation for AI agents." width="380" /></picture></a>
  <a href="https://github.com/anvia-hq/channels"><picture><source media="(prefers-color-scheme: dark)" srcset=".github/assets/channels-banner.svg" /><img src=".github/assets/channels-banner-light.svg" alt="Anvia Channels — connect agents to Discord, Slack, and Telegram." width="380" /></picture></a>
</p>

## Why Anvia

- Provider-neutral clients for OpenAI-compatible APIs, Anthropic, Gemini, and Mistral — your agent architecture should not belong to your model provider.
- Agent and tool APIs that keep application behavior explicit and typed.
- Memory contracts for agent state and history, stored where you decide.
- Embeddable runtime contracts that keep provider, memory, observability, storage, and service choices in application code.
- Structured extraction and output schemas for turning model responses into usable data.
- Pipeline primitives for composing functions, agents, extractors, batches, and parallel branches.
- Retrieval adapters for in-memory search, local embeddings, ChromaDB, LanceDB, Milvus, pgvector, Pinecone, Qdrant, Redis, and Weaviate.
- Browser automation and sandboxed execution, so agents can act on the world and run work in environments you control.
- Evaluation primitives for scoring and regression-testing agent behavior on your infrastructure.
- Optional Studio, Lens, MCP, local skills, Langfuse, and OpenTelemetry integrations.

Anvia is an agent stack, not an agent platform. A platform asks you to build inside its system; a stack gives you components to build inside your own. If you are building an AI product you expect to own for years, ownership becomes part of the architecture.

## Quick Start

Install the core runtime and a provider adapter:

```sh
pnpm add @anvia/core@latest @anvia/openai@latest
```

Create a provider client, construct an agent, and run it from your app:

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey });
const model = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const supportAgent = new Agent({
  id: "support",
  model: model,
  instructions: "Answer support questions clearly. Ask for missing details.",
});

const response = await supportAgent.generate({
  prompt: "A customer cannot reset their password. What should I check first?",
});

if (response.type !== "response") {
  throw new Error(`Agent returned ${response.type}`);
}
console.log(response.output);
```

Use the same runtime shape with other providers:

```sh
pnpm add @anvia/anthropic@latest @anvia/gemini@latest @anvia/mistral@latest
```

Anvia clients take explicit constructor values and do not read environment variables on their own, so credentials stay in your existing configuration layer.

## Studio

Anvia includes `@anvia/studio`, a local browser UI for inspecting and running agents, tools, sessions, traces, pipelines, memory, status, and knowledge during development.

Studio connects to the actual agent instance your application creates. Your model, instructions, tools, middleware, memory, and policies remain application code — one agent, one source of truth. Inspect, test, intervene, and replay against the running agent, then ship it unchanged.

Add one line to serve any agent in Studio:

```ts
new Studio([agent]).start({ port: 4021 });
```

## What You Can Build

| Capability    | Use it for                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Agents        | Model workflows with instructions, context, tools, lifecycle callbacks, memory, approvals, and streaming. |
| Tools         | Safe, typed access to application-owned actions such as lookup, search, mutation, approval, or dispatch.  |
| Extractors    | Schema-shaped data from text, tickets, documents, messages, and model responses.                          |
| Pipelines     | Explicit multi-step workflows that combine functions, agents, extraction, branching, and batching.        |
| Retrieval     | Embeddings, vector search, document context, metadata filters, and RAG workflows.                         |
| Memory        | Agent memory using storage you control.                                                                   |
| Durable       | Experimental SQLite-backed agent recovery, persisted approvals, and reconnectable progress.               |
| Browser       | Web interaction for agents, with the browser lifecycle owned by your application.                         |
| Sandbox       | Give agents execution capabilities without giving up control of the environment.                          |
| Observability | Run, generation, tool, usage, trace, and eval events for production visibility.                           |
| Evaluation    | Score and regression-test agent behavior with evals that run on your infrastructure.                      |
| Studio        | A local browser UI for inspecting agents, sessions, traces, pipelines, tools, approvals, and knowledge.   |
| Lens          | Observe and evaluate production agents on infrastructure you control.                                     |

## Cookbook

The [cookbook](cookbook/README.md) is the fastest way to see Anvia in motion. It walks from a first text call through tools, structured output, providers, multimodal inputs, pipelines, retrieval, multi-agent workflows, evals, Studio, and integrations.

Run the first example from the repository root:

```sh
pnpm install
pnpm cookbook:basics:01
```

Run Studio locally:

```sh
pnpm cookbook:studio:01
```

## Learn More

- [Documentation](https://docs.anvia.dev/)
- [Getting started](https://docs.anvia.dev/guide/getting-started)
- [Core concepts](https://docs.anvia.dev/guide/core-concepts)
- [Package catalog](https://docs.anvia.dev/packages/catalog)
- [Core package](https://docs.anvia.dev/packages/core)
- [Durable execution](packages/durable/README.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT

Anvia is free and open source. Build agents with your preferred model providers, keep your data in your own databases, run locally, self-host, and deploy without an Anvia account.
