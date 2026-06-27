---
title: "@anvia/langfuse: Examples"
description: "Small examples that show @anvia/langfuse at the package boundary."
section: packages
sidebar:
  group: "@anvia/langfuse"
  order: 4
  label: "Examples"
---
## Minimal trace

```ts
import { AgentBuilder } from "@anvia/core";
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({ serviceName: "support" });
const agent = new AgentBuilder("support", model).observe(tracing).build();

await agent.prompt("Summarize this ticket.").send();
await tracing.flush();
```
## Product-shaped eval reporting

```ts
import { createLangfuseEvalReporter, langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({ serviceName: "support-evals" });
const reporter = createLangfuseEvalReporter(tracing, {
  onMissingTrace: "warn",
  truncateInputAt: 2048,
});

await runEvalSuite(suite, { reporter });
await tracing.flush();
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/langfuse integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
