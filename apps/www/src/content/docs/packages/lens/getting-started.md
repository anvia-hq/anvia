---
title: "@anvia/lens: Getting Started"
description: "Install @anvia/lens and send native telemetry to Anvia Lens."
section: packages
sidebar:
  group: "@anvia/lens"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/lens @anvia/core
```

Set `ANVIA_LENS_BASE_URL`, `ANVIA_LENS_PUBLIC_KEY`, `ANVIA_LENS_SECRET_KEY`, and
`ANVIA_LENS_SERVICE_NAME`. Optional deployment context uses `ANVIA_LENS_ENVIRONMENT` and
`ANVIA_LENS_RELEASE`.

## Connect an agent

Use your application's configured `CompletionModel` as `model`:

```ts
import { AgentBuilder, type CompletionModel } from "@anvia/core";
import { lens } from "@anvia/lens";

declare const model: CompletionModel; // Supplied by your provider adapter.

const tracing = lens.create();
const agent = new AgentBuilder("support", model).observe(tracing).build();

await agent.prompt("Summarize this ticket.").send();
await tracing.flush();
```

Call `shutdown()` when the process exits. Short-lived jobs should call `flush()` after their final
run.
