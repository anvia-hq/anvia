---
title: "@anvia/langfuse: Getting Started"
description: "Install @anvia/langfuse and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/langfuse"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/langfuse @anvia/core
```

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optionally `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, and `LANGFUSE_SERVICE_NAME` for env-based tracing configuration.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({
  serviceName: "support-agent",
});

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .observe(tracing)
  .build();

await agent.prompt("Summarize this ticket.").send();
await tracing.flush();
```
## Next step

Continue with [Usage Patterns](/docs/packages/langfuse/usage-patterns).
