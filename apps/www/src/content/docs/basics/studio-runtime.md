---
title: Studio runtime
description: Run and inspect local agents with the Anvia Studio browser UI.
section: basics
sidebar:
  group: Tools and Studio
  order: 2
---

Use `@anvia/studio` when you want a local browser surface for running agents and inspecting runtime behavior.

## When to use this

Studio is useful while developing agents:

- Send prompts in a playground.
- Inspect sessions and traces.
- Review tool calls and tool approvals.
- Explore memory, status, knowledge, pipelines, and MCP configuration when those features are enabled.

## Prerequisites

Install `@anvia/studio` and keep a local agent definition available for development.

## Start Studio

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const agent = new AgentBuilder("support", client.completionModel("gpt-5"))
  .name("Support")
  .description("Answers support questions.")
  .instructions("Answer support questions clearly.")
  .build();

new Studio([agent]).start({
  port: 4021,
});
```

Then open:

```txt
http://localhost:4021/playground
```

## What happens

`Studio` serves an HTTP runtime and browser UI for the agents you pass in. The playground can run prompts against the selected agent. The UI can also expose sessions, traces, tools, memory, status, knowledge, pipelines, evals, and MCP pages when your runtime has those capabilities configured.

## Persist sessions

Studio uses in-memory storage by default. Pass a SQLite store when you want local sessions and traces to survive process restarts:

```ts
import { Studio, createSqliteSessionStore } from "@anvia/studio";

new Studio([agent], {
  stores: {
    sessions: createSqliteSessionStore({ path: ".anvia/studio.sqlite" }),
  },
}).start({ port: 4021 });
```

SQLite storage uses dedicated `anvia_studio_*` tables.

## Check yourself

Open the playground URL and confirm your agent appears in the UI. Send one prompt and verify the run is visible in Studio.

## Next

Move to Advanced when you need deeper runtime configuration.

[Advanced configuration](/docs/advanced/configuration)
