<p align="center">
  <img src="apps/www/public/assets/logo.png" alt="Anvia logo" width="180" />
</p>

<h1 align="center">Anvia</h1>

<p align="center">
  <strong>Build provider-agnostic AI agents and workflows in TypeScript.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-89c83f?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/runtime-Node.js-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node.js runtime" />
</p>

Anvia is a TypeScript runtime for agents, tools, structured extraction, retrieval, pipelines, and observability inside your application code.

It gives teams more structure than raw model calls without forcing a heavyweight orchestration stack. You bring the product, data, permissions, persistence, deployment, and side effects. Anvia gives you typed AI workflow primitives that fit around them.

## Why Anvia

- Provider-neutral clients for OpenAI-compatible APIs, Anthropic, Gemini, and Mistral.
- Agent and tool APIs that keep application behavior explicit and typed.
- Structured extraction and output schemas for turning model responses into usable data.
- Pipeline primitives for composing functions, agents, extractors, batches, and parallel branches.
- Retrieval adapters for in-memory search, local embeddings, ChromaDB, Qdrant, and pgvector.
- Optional Studio, MCP, local skills, Langfuse, and OpenTelemetry integrations.

## Quick Start

Install the core runtime and a provider adapter:

```sh
pnpm add @anvia/core @anvia/openai
```

Create a provider client, build an agent, and run it from your app:

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey });
const model = client.completionModel("gpt-5.5");

const supportAgent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly. Ask for missing details.")
  .build();

const response = await supportAgent
  .prompt("A customer cannot reset their password. What should I check first?")
  .send();

console.log(response.output);
```

Use the same runtime shape with other providers:

```sh
pnpm add @anvia/anthropic @anvia/gemini @anvia/mistral
```

Anvia clients take explicit constructor values and do not read environment variables on their own, so credentials stay in your existing configuration layer.

## Studio

Anvia includes `@anvia/studio`, a local browser UI for inspecting and running agents, tools, sessions, traces, pipelines, memory, status, and knowledge during development. Add one line to serve any agent in Studio:

```ts
new Studio([agent]).start({ port: 4021 });
```

<p align="center">
  <img src="apps/www/public/assets/illustrations/agent-gateway-card.png" alt="Anvia agent gateway preview" width="960" />
</p>

<p align="center">
  <em>Preview of the Anvia website and agent gateway.</em>
</p>

## What You Can Build

| Capability | Use it for |
| --- | --- |
| Agents | Promptable workflows with instructions, context, tools, hooks, history, streaming, and typed outputs. |
| Tools | Safe, typed access to application-owned actions such as lookup, search, mutation, approval, or dispatch. |
| Extractors | Schema-shaped data from text, tickets, documents, messages, and model responses. |
| Pipelines | Explicit multi-step workflows that combine functions, agents, extraction, branching, and batching. |
| Retrieval | Embeddings, vector search, document context, metadata filters, and RAG workflows. |
| Observability | Run, generation, tool, usage, trace, and eval events for production visibility. |
| Studio | A local browser UI for inspecting agents, sessions, traces, pipelines, tools, approvals, and knowledge. |

## Cookbook

The [cookbook](examples/cookbook/README.md) is the fastest way to see Anvia in motion. It walks from a first text call through tools, structured output, providers, multimodal inputs, pipelines, retrieval, multi-agent workflows, evals, Studio, and integrations.

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

- [Docs Overview](apps/www/src/content/docs/basics/overview.md)
- [Install Packages](apps/www/src/content/docs/basics/install-packages.md)
- [Build your first agent](apps/www/src/content/docs/basics/build-your-first-agent.md)
- [Examples](apps/www/src/content/docs/examples/overview.md)
- [Packages](apps/www/src/content/docs/packages/core/overview.md)
- [Contributing](CONTRIBUTING.md)

## Project Activity

![Repobeats analytics image](https://repobeats.axiom.co/api/embed/a63db5f32641718a48cb706d9957e94fa413871d.svg "Repobeats analytics image")

## License

MIT
