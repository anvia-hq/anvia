---
title: "@anvia/logger: Examples"
description: "Small examples that show @anvia/logger at the package boundary."
section: packages
sidebar:
  group: "@anvia/logger"
  order: 4
  label: "Examples"
---
## Minimal logger observer

```ts
import { AgentBuilder } from "@anvia/core";
import { createConsoleLogger, createLoggerObserver } from "@anvia/logger";

const logger = createConsoleLogger({ name: "support", level: "debug" });
const agent = new AgentBuilder("support", model)
  .observe(createLoggerObserver(logger))
  .build();
```
## Product-shaped logger

```ts
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";

export function createObservedAgent(input: { requestId: string }) {
  const logger = createPinoLogger({
    name: "support-agent",
    level: "info",
    base: { requestId: input.requestId },
  });

  return new AgentBuilder("support", model)
    .observe(createLoggerObserver(logger, { includeInputs: false, includeOutputs: false }))
    .build();
}
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/logger integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
