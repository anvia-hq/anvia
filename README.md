<p align="center">
  <img src="https://docs.anvia.dev/logo.svg" alt="Anvia logo" width="180" />
</p>

<p align="center">
  <strong>Build provider-agnostic AI agents and workflows in TypeScript.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-89c83f?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/runtime-Node.js-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node.js runtime" />
</p>

Anvia is a TypeScript runtime for agents, tools, structured extraction, retrieval, pipelines, and observability inside your application code.

It gives teams more structure than raw model calls without forcing a heavyweight orchestration stack. You bring the product, data, permissions, persistence, deployment, and side effects. Anvia gives you small, explicit AI runtime contracts that fit around them.

The core design is dependency-injection oriented: your app creates provider models, typed tools, memory stores, vector indexes, observers, services, and transports, then passes the relevant objects into Anvia agents, runners, or adapters. Anvia runs the model/tool loop; your application keeps ownership of product architecture.

## Release Channels

Anvia 1.0 is currently available as a release candidate. The npm `latest` tag remains on the v0
maintenance line until 1.0 reaches general availability.

- Use `@rc` for new development and 1.0 validation. RC APIs can still change before GA.
- Use `@latest` for the supported v0 line. v0 receives bug and security fixes, not new features.
- Keep all Anvia packages on the same channel; do not mix v0 and v1 packages in one application.

The 1.0 candidate must complete a seven-day frozen soak before GA. See the
[1.0 release policy](docs/releases/v1.md) for the branch, npm-tag, freeze, and promotion rules.

## Why Anvia

- Provider-neutral clients for OpenAI-compatible APIs, Anthropic, Gemini, and Mistral.
- Agent and tool APIs that keep application behavior explicit and typed.
- Embeddable runtime contracts that keep provider, memory, observability, storage, and service choices in application code.
- Structured extraction and output schemas for turning model responses into usable data.
- Pipeline primitives for composing functions, agents, extractors, batches, and parallel branches.
- Retrieval adapters for in-memory search, local embeddings, ChromaDB, Qdrant, and pgvector.
- Optional Studio, MCP, local skills, Langfuse, and OpenTelemetry integrations.

## Quick Start

Install the core runtime and a provider adapter:

```sh
pnpm add @anvia/core@rc @anvia/openai@rc
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

if (response.status !== "completed") {
  throw new Error(`Agent did not complete: ${response.status}`);
}
console.log(response.output);
```

Use the same runtime shape with other providers:

```sh
pnpm add @anvia/anthropic@rc @anvia/gemini@rc @anvia/mistral@rc
```

Anvia clients take explicit constructor values and do not read environment variables on their own, so credentials stay in your existing configuration layer.

## Studio

Anvia includes `@anvia/studio`, a local browser UI for inspecting and running agents, tools, sessions, traces, pipelines, memory, status, and knowledge during development. Add one line to serve any agent in Studio:

```ts
new Studio([agent]).start({ port: 4021 });
```

## What You Can Build

| Capability | Use it for |
| --- | --- |
| Agents | Model workflows with instructions, context, tools, lifecycle callbacks, memory, approvals, and streaming. |
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

- [Documentation](https://docs.anvia.dev/)
- [Getting started](https://docs.anvia.dev/guide/getting-started)
- [Core concepts](https://docs.anvia.dev/guide/core-concepts)
- [Package catalog](https://docs.anvia.dev/packages/catalog)
- [Core package](https://docs.anvia.dev/packages/core)
- [Contributing](CONTRIBUTING.md)

## Project Activity

![Repobeats analytics image](https://repobeats.axiom.co/api/embed/a63db5f32641718a48cb706d9957e94fa413871d.svg "Repobeats analytics image")

## License

MIT
