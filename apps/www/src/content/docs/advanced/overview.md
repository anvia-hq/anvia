---
title: Advanced guide
description: Plan and operate production agents with the core runtime.
section: advanced
sidebar:
  group: Production architecture
  order: 1
---

The advanced guide is for the point where a working agent becomes part of a product system. Basics shows how to call a model, build an agent, add tools, stream events, and store simple memory. This section is about the boundaries around that runtime: packages, deployment shape, model choices, configuration, error handling, and the code your app must own.

`@anvia/core` is provider-neutral. It gives you the runtime contracts for agents, completions, tools, memory, events, structured output, pipelines, retrieval, MCP, evals, and observers. It does not own your auth, database, queues, product permissions, billing logic, deployment, or user interface.

## What Changes In Production

The main change is ownership. In a quickstart, the same file often creates the provider client, builds the agent, defines tools, sends a prompt, and prints the answer. In production, those responsibilities need clearer boundaries.

A route or worker receives the product request. A runner validates input, authenticates the caller, loads request state, chooses the agent, and maps failures. Tools enforce product permissions and call services. Storage records history, events, approvals, idempotency, and audit data. The Anvia runtime handles the model-tool loop, hooks, schemas, streaming events, and observer events.

This split matters because model behavior is only one part of product correctness. Most production failures come from unclear permission boundaries, global request state, unbounded retries, missing persistence, or provider capabilities that were assumed but never tested.

## Read By Concern

Start with [Package exports](/docs/advanced/package-exports) if you are deciding how to import core APIs across app code and integration packages. Then read [Production agent architecture](/docs/advanced/agent-architecture) to shape the harness around an agent run.

Read [Runtime boundaries](/docs/advanced/runtime-boundaries) when deciding what belongs on the server, in a worker, in browser code, or in Studio. Read [Models and capabilities](/docs/advanced/models-and-capabilities) before exposing model choices, fallbacks, structured output, tools, or streaming to users.

Use [Runtime lifecycle](/docs/advanced/runtime-lifecycle) to understand what happens inside `.send()` or `.stream()`: memory loading, turns, dynamic context, tool calls, event storage, hooks, observers, and failures.

Use [Configuration](/docs/advanced/configuration) to decide which values belong in environment config, agent defaults, factories, or per-request overrides. Use [Errors and limits](/docs/advanced/errors-and-limits) before shipping workflows with tool calls, approvals, provider retries, or user-facing streams.

## Production Shape

The default architecture is intentionally boring:

- keep provider clients and secrets in server-only code
- build reusable models from provider clients
- use stable agent ids for traces, Studio, sessions, and workflows
- create request-scoped tools when permissions or tenant context changes
- keep product side effects inside services called by tools
- store messages and event logs outside the model loop
- attach trace metadata that is useful but safe to log
- map runtime errors at the runner boundary

That shape works for an HTTP chat route, a background support workflow, an extraction job, a research pipeline, and a Studio-registered local agent. Once it is clear, advanced features such as retrieval, dynamic tools, nested agents, evals, and long-running pipelines have a place to attach without turning the prompt into the architecture.

## What To Avoid

Do not make prompt instructions carry product permissions. Do not let tools read the current user from global state. Do not assume a fallback model supports the same tool or schema behavior as the primary model. Do not point browser code at provider credentials or vector-store clients. Do not treat Studio storage as your product memory policy.

The practical rule is simple: if a decision affects product correctness, security, or data ownership, keep it in application code or a tool. If a decision affects how a model is prompted, constrained, streamed, or observed, configure it on the agent or prompt request.
