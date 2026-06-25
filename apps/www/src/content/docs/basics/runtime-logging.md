---
title: Runtime logging
description: Send runtime observer events into application logs.
section: basics
sidebar:
  group: App integration
  order: 3
---

Use `@anvia/logger` when agent lifecycle events should flow into your application logger.

## When to use this

Use runtime logging for local debugging and production operations:

- See when runs start and finish.
- Inspect tool calls.
- Track failures.
- Correlate runtime behavior with application logs.

## Add a logger observer

```ts
import { AgentBuilder } from "@anvia/core";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";

const logger = createPinoLogger({
  name: "support-app",
  level: "info",
});

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .observe(createLoggerObserver(logger))
  .build();
```

## Use console logging locally

```ts
import { AgentBuilder } from "@anvia/core";
import { createConsoleLogger, createLoggerObserver } from "@anvia/logger";

const logger = createConsoleLogger({
  name: "support-app",
  level: "debug",
});

const agent = new AgentBuilder("support", model)
  .observe(createLoggerObserver(logger))
  .build();
```

## Payload defaults

The logger observer omits final outputs, full model requests, model responses, and tool results by default. Opt in only when your data policy allows those payloads in logs.

## Next

Move to Advanced when you need deeper runtime controls.

[Advanced configuration](/docs/advanced/configuration)
