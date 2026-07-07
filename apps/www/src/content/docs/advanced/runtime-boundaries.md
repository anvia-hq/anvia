---
title: Runtime boundaries
description: Separate clients, servers, workers, tools, and model calls.
section: advanced
sidebar:
  group: Production architecture
  order: 4
---

Anvia is designed around explicit runtime boundaries. The core package provides provider-neutral primitives. Other packages adapt providers, transports, stores, tools, and observability systems.

Good boundaries make agents easier to test and safer to deploy. They also keep provider SDKs, database clients, secrets, and product permissions out of places they do not belong.

## Package Boundaries

`@anvia/core` contains the runtime contracts. Provider packages such as `@anvia/openai`, `@anvia/anthropic`, `@anvia/gemini`, and `@anvia/mistral` turn provider SDKs into Anvia models.

Embedding and vector packages adapt retrieval infrastructure. Observability packages connect runtime events to systems such as OpenTelemetry and Langfuse. `@anvia/server` and `@anvia/react` help move streams through app transports. Studio provides a local and internal runtime UI.

Most integration packages declare `@anvia/core` as a peer dependency. That keeps runtime contracts shared while letting provider SDKs and adapters evolve separately.

## Runtime Object Boundaries

The provider client owns credentials, base URLs, headers, and SDK setup. A model is the reusable provider capability created from that client. An agent adds instructions, tools, context, hooks, observers, memory, and limits. A session supplies the durable memory context for conversation history. A prompt request carries the current input, trace metadata, and one-off overrides.

Create these objects in startup code, factories, tests, jobs, or request handlers. Anvia does not require a global registry, and you should not need one to make agents discoverable inside your app.

## Dependency Injection Shape

Anvia's runtime boundaries are meant to be dependency-injection friendly. Provider clients
become model objects before core sees them. Memory is a `MemoryStore` passed into an
agent. Retrieval is a vector index passed into dynamic context or a tool. Observability is
an observer passed into `AgentBuilder.observe(...)`. Product services are called from
tools or runners, not hidden behind prompt text.

This keeps framework ownership narrow. Anvia owns the agent loop, tool execution,
streaming events, hooks, middleware, approvals, and runtime contracts. Your application
owns the concrete services, storage systems, permissions, transports, deployment, and
product response shape.

## Server, Worker, And Browser Boundaries

Keep provider clients, API keys, file loaders, PDF loaders, vector-store clients, and side-effect tools on the server or in workers.

Browser code should receive only product-safe outputs or streams. A React UI can submit a message to your app route, and that route can call an Anvia runner. The browser does not need provider credentials, vector-store clients, or privileged tool implementations.

Workers are useful for long-running pipelines, ingestion, evals, and retried jobs. In those cases, the route should enqueue work and the worker should own the Anvia run. That keeps user-facing latency separate from provider latency, retries, and downstream service failures.

## Long-Running Work

Do not force every agent run into a request-response route. Some workflows should become jobs:

- document ingestion and embedding
- research pipelines with many model calls
- nightly eval suites
- bulk extraction
- approval workflows that may wait on a human

For these workflows, store a job id and status in your app database. The worker can emit events, write trace metadata, persist intermediate outputs, and retry safe steps. The user-facing route can poll or subscribe to job status without holding a provider request open.

## Studio Boundary

Studio is useful for local development and internal operations. Treat it as a runtime inspection surface, not as your product authorization layer.

Your app still owns product user authentication, reviewer permissions for approvals, production storage policy, deployment, network access, user-facing UI, and response shape. Studio can help inspect sessions, traces, tools, and registered agents, but it should not become the only place where production permissions are enforced.

## Practical Rule

When a dependency reaches outside the process, make the boundary explicit. Provider SDKs, databases, queues, object stores, vector stores, and tracing systems should be injected into runners, factories, tools, or adapters instead of hidden inside prompt text.

If a module cannot run in a unit test without real secrets, it is probably doing too much. Split provider setup, product services, agent construction, and runner logic until each piece has a clear test seam.

## Review Questions

Before shipping a runtime boundary, ask:

- Can the route be tested without a provider call?
- Can tools be tested without the agent?
- Can the agent be registered in Studio without production secrets?
- Can browser code render the stream without seeing private tool results?
- Can a worker resume or fail a long-running run without losing audit detail?

If the answer is no, the boundary is probably still too implicit.
