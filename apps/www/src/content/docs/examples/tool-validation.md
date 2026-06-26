---
title: Tool Validation
description: The pattern for validating tool inputs, outputs, and product states.
section: examples
sidebar:
  group: Tool Patterns
  order: 4
---

Tool schemas validate model arguments. Product services validate business state. Use both.

## Scenario

The agent can change a shipping address, but only before the order ships and only to an address verified by the address service.

## Example

```ts
const changeShippingAddress = createTool({
  name: "change_shipping_address",
  description: "Change the shipping address for an unshipped order.",
  input: z.object({
    orderId: z.string(),
    address: z.object({
      line1: z.string(),
      city: z.string(),
      country: z.string().length(2),
      postalCode: z.string(),
    }),
  }),
  output: z.object({
    orderId: z.string(),
    status: z.enum(["updated", "not_allowed"]),
    message: z.string(),
  }),
  async execute({ orderId, address }) {
    const verified = await scope.services.addresses.verify(address);

    if (!verified.ok) {
      return { orderId, status: "not_allowed", message: "Address could not be verified." };
    }

    const order = await scope.services.orders.lookupForUser({
      orderId,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
    });

    if (order.status !== "processing") {
      return { orderId, status: "not_allowed", message: "Order already shipped." };
    }

    await scope.services.orders.changeAddress({ orderId, address: verified.address });
    return { orderId, status: "updated", message: "Shipping address updated." };
  },
});
```

## Validation Layers

| Layer | Catches |
| --- | --- |
| Zod input schema | malformed tool arguments |
| service lookup | missing or unauthorized product records |
| business rules | shipped order, policy limits, disabled account |
| output schema | accidental unsafe or inconsistent return values |

## Failure Modes

- The schema validates shape but not business state.
- Service errors leak internal messages to the model.
- Tool throws for expected denial states instead of returning a typed denial.
- Output includes fields that should stay server-side.

## Next Patterns

- [Tool Boundaries](/docs/examples/tool-boundaries)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Testing Harness](/docs/examples/testing-harness)
