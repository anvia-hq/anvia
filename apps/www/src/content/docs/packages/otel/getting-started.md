---
title: "@anvia/otel: Getting Started"
description: "Install @anvia/otel and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/otel"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/otel @anvia/core @opentelemetry/api
```

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { otel } from "@anvia/otel";

const tracing = otel.create({
  tracerName: "support-agent",
});

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .observe(tracing)
  .build();
```
## Next step

Continue with [Usage Patterns](/docs/packages/otel/usage-patterns).
