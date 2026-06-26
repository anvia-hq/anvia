---
title: Human Input
description: The pattern for asking a person before continuing a run.
section: examples
sidebar:
  group: Tool Patterns
  order: 5
---

Human input is for missing facts, approvals, or policy decisions that should not be guessed by the model.

## Scenario

The agent wants to cancel an order, but the user did not confirm whether they want store credit or a card refund.

## Example

```ts
const askRefundPreference = createTool({
  name: "ask_refund_preference",
  description: "Ask the user how they want a refund handled.",
  input: z.object({
    orderId: z.string(),
    options: z.array(z.enum(["store_credit", "card_refund"])),
  }),
  output: z.object({
    preference: z.enum(["store_credit", "card_refund"]),
  }),
  async execute({ orderId, options }) {
    return scope.humanInput.ask({
      kind: "choice",
      title: "Refund preference",
      message: `How should order ${orderId} be refunded?`,
      options,
    });
  },
});
```

Use the result in a guarded side-effect tool:

```ts
const cancelOrder = createTool({
  name: "cancel_order",
  description: "Cancel an order using the confirmed refund preference.",
  input: z.object({
    orderId: z.string(),
    preference: z.enum(["store_credit", "card_refund"]),
  }),
  output: z.object({ cancellationId: z.string() }),
  execute: (input) =>
    scope.services.orders.cancel({
      ...input,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
      idempotencyKey: scope.idempotencyKey,
    }),
});
```

## Failure Modes

- The model invents missing product facts.
- Approval is asked after the write already happened.
- Human questions are not persisted, so resumed runs lose state.
- The UI cannot distinguish clarification from approval.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Streaming Events](/docs/examples/streaming-events)
- [Backoffice Agent](/docs/examples/backoffice-agent)
