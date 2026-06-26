---
title: Tool Boundaries
description: The pattern for exposing product behavior through narrow, typed tools.
section: examples
sidebar:
  group: Tool Patterns
  order: 1
---

Tools are the model's narrow interface to your application. They should call permission-aware services, not expose raw databases or broad internal APIs.

## Scenario

A support agent can look up an order and create a support ticket. Both tools must be scoped to the signed-in user and tenant.

## Example

```ts
import { createTool } from "@anvia/core";
import { z } from "zod";

export function createSupportTools(scope: SupportToolScope) {
  return [
    createTool({
      name: "lookup_order",
      description: "Look up one order owned by the current customer.",
      input: z.object({ orderId: z.string() }),
      output: z.object({
        id: z.string(),
        status: z.string(),
        canChangeAddress: z.boolean(),
      }),
      execute: ({ orderId }) =>
        scope.services.orders.lookupForUser({
          orderId,
          userId: scope.user.id,
          tenantId: scope.user.tenantId,
        }),
    }),
    createTool({
      name: "create_ticket",
      description: "Create a support ticket for the current customer.",
      input: z.object({
        subject: z.string(),
        body: z.string(),
        orderId: z.string().optional(),
      }),
      output: z.object({ ticketId: z.string() }),
      execute: (input) =>
        scope.services.tickets.createForUser({
          ...input,
          userId: scope.user.id,
          tenantId: scope.user.tenantId,
        }),
    }),
  ];
}
```

The model sees the names, descriptions, and schemas. The service layer still owns tenant filtering, authorization, and writes.

## Failure Modes

- Tool accepts `userId` from the model instead of closing over the authenticated user.
- Tool returns full records when the model needs only a few fields.
- Tool directly writes to storage without service validation.
- Prompt text says "only access this user's orders" but the service does not enforce it.

## Next Patterns

- [Tool Validation](/docs/examples/tool-validation)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Dynamic Tool Catalogs](/docs/examples/dynamic-tool-catalogs)
