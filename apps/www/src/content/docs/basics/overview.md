---
title: Overview
description: Build, run, extend, and connect your first Anvia agent.
section: basics
sidebar:
  group: Runtime
  order: 1
---

Basics is a guided path from one provider-neutral model call to a working agent that can stream, use tools, remember sessions, use context, and connect to a product UI.

## Design philosophy

Anvia is not different because it has primitives. The difference is the boundary those
primitives keep. Core is a small, explicit runtime layer that accepts the dependencies
your application creates: provider models, tools, memory stores, vector indexes, observers,
services, and transports.

Anvia runs the agent/tool loop and emits runtime events. Your app still owns product
architecture, auth, permissions, data access, persistence, deployment, and the response
shape users see. This keeps Anvia dependency-injection oriented: build dependencies in
application code, pass them into agents, runners, tools, or adapters, and replace them in
tests.

## What you will build

By the end of this section, you will have:

- A provider model from `@anvia/openai`.
- A direct completion to verify the model works.
- An agent with reusable instructions and turn limits.
- A prompt flow that can return a final result or stream runtime events.
- Tool, memory, and context examples you can adapt to your product.
- A server stream, React client, runtime logger, and local Studio runtime.

## Prerequisites

You need a TypeScript project that can use ESM imports, a package manager such as `pnpm`, and an API key for the provider you choose. The examples use OpenAI first so the path stays concrete.

Set your key before running examples that call the provider:

```bash
OPENAI_API_KEY=...
```

## Main quickstart path

Follow this path in order when you are new to Anvia:

1. **Install packages**: add `@anvia/core` and one provider package.
2. **Direct completion**: call the model once to verify credentials and provider setup.
3. **Build your first agent**: wrap the model in reusable runtime behavior.
4. **Send a prompt**: run the agent and handle the final response.
5. **Stream an agent response**: read runtime events while the agent is working.
6. **Add tools**: let the agent call typed product actions.
7. **Add memory**: persist messages across durable sessions.
8. **Add context**: attach stable facts to every request.
9. **Server streams**: expose agent events from an HTTP route.
10. **React client**: consume the stream in a React UI.
11. **Runtime logging**: send runtime events to application logs.
12. **Studio runtime**: run and inspect the agent in a local browser UI.

## Optional detours

Use these pages when they match your current task:

- **Stream completion**: stream one direct model call before you introduce agents.
- **Structured output**: ask a model call for schema-validated data.
- **Sandbox tools**: give an agent command and file tools inside an isolated workspace.

## Runtime layers

`@anvia/core` contains provider-neutral primitives: completions, agents, tools, memory, streaming events, and context.

Provider packages such as `@anvia/openai` create models that implement the core interfaces. App packages such as `@anvia/server`, `@anvia/react`, and `@anvia/logger` connect runtime output to product surfaces. Tooling packages such as `@anvia/sandbox` and `@anvia/studio` help you run and inspect agents during development.

## Basic stack

Most examples in Basics use OpenAI as the first provider:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");
```

After you have a model, every runtime feature builds from there.

## Check yourself

Before you continue, confirm that you know which provider package you will use and where your provider API key will come from.

## Next

Install the smallest useful runtime stack.

[Install packages](/docs/basics/install-packages)
