---
title: "@anvia/core: Examples"
description: "Small examples that show @anvia/core at the package boundary."
section: packages
sidebar:
  group: "@anvia/core"
  order: 4
  label: "Examples"
---
## Minimal direct completion

```ts
import { createCompletion } from "@anvia/core";

const result = await createCompletion(model, {
  input: "Summarize this ticket.",
  instructions: "Answer in one sentence.",
});

console.log(result.text);
```
## Product-shaped agent factory

```ts
import { AgentBuilder, createTool } from "@anvia/core";
import { z } from "zod";

export function createSupportAgent(input: { model: CompletionModel; orders: OrderService }) {
  const lookupOrder = createTool({
    name: "lookup_order",
    description: "Look up an order by id.",
    input: z.object({ orderId: z.string() }),
    execute: ({ orderId }) => input.orders.lookup(orderId),
  });

  return new AgentBuilder("support", input.model)
    .instructions("Help customers with order questions.")
    .tool(lookupOrder)
    .defaultMaxTurns(4)
    .build();
}
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/core integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
