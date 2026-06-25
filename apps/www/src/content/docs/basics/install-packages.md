---
title: Install packages
description: Install the smallest stack and choose the provider package your app needs.
section: basics
sidebar:
  group: Runtime
  order: 2
---

Install `@anvia/core` plus one provider package. The core package is provider-neutral; a provider package turns a vendor API into a model that the core runtime can call.

## Minimal install

For the OpenAI examples in Basics:

```bash
pnpm add @anvia/core @anvia/openai
```

Set your provider credentials in the environment:

```bash
OPENAI_API_KEY=...
```

Then create a model:

```ts
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");
```

## Optional packages

Add these only when your app needs them:

```bash
pnpm add @anvia/server @anvia/react @anvia/logger
```

`@anvia/server` exposes runtime streams from server routes. `@anvia/react` consumes runtime streams in React clients. `@anvia/logger` sends runtime observer events into application logs.

Add local development tooling when you need isolated command execution or a browser runtime console:

```bash
pnpm add @anvia/sandbox @anvia/studio
```

`@anvia/sandbox` creates sandbox-backed tools for agents. `@anvia/studio` serves a local UI for running agents, inspecting sessions, and viewing traces.

## Schema validation

Pages that use structured output or tools import Zod directly:

```bash
pnpm add zod
```

Use Zod when your app needs validated inputs or schema-validated model output.

## Next

Call the model directly before adding agents.

[Direct completion](/docs/basics/direct-completion)
