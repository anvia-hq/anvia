---
title: Dynamic Tool Catalogs
description: The pattern for selecting relevant tools from a larger catalog.
section: examples
sidebar:
  group: Tool Patterns
  order: 2
---

Dynamic tool catalogs keep large tool sets out of every model request. The app indexes tool descriptions, then Anvia selects the most relevant tools for the current prompt.

## Scenario

An internal support agent has 80 admin tools. A refund question should expose refund and order tools, not deployment or billing-plan tools.

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { createToolIndex } from "@anvia/core/tool";

const allSupportTools = [
  ...createOrderTools(scope),
  ...createRefundTools(scope),
  ...createTicketTools(scope),
  ...createAccountTools(scope),
];

const supportToolIndex = await createToolIndex(embeddingModel, allSupportTools, {
  metadata: { tenantId: scope.user.tenantId },
});

const agent = new AgentBuilder("support-admin", model)
  .instructions("Use the smallest relevant tool set for each request.")
  .dynamicTools(supportToolIndex, {
    topK: 5,
    threshold: 0.68,
  })
  .defaultMaxTurns(4)
  .build();
```

For high-risk tools, dynamic selection is not enough. Keep approval or permission checks in the tool itself.

```ts
const issueRefund = createRefundTool({
  ...scope,
  requirePermission: "orders:refund",
  requireIdempotencyKey: true,
});
```

## Failure Modes

- Search threshold is so low that unrelated tools are exposed.
- Tool descriptions are vague, so retrieval picks the wrong capability.
- Dangerous tools rely only on catalog filtering.
- The catalog is global when tools should be tenant- or role-specific.

## Next Patterns

- [Tool Boundaries](/docs/examples/tool-boundaries)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Testing Harness](/docs/examples/testing-harness)
