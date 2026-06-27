---
title: "@anvia/logger: Getting Started"
description: "Install @anvia/logger and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/logger"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/logger @anvia/core
```

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";

const logger = createPinoLogger({
  name: "support-agent",
  level: "info",
});

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .observe(createLoggerObserver(logger))
  .build();
```
## Next step

Continue with [Usage Patterns](/docs/packages/logger/usage-patterns).
