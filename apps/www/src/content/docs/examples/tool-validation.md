---
title: Tool Validation
description: A pattern for validating model arguments, product state, and safe tool outputs.
section: examples
sidebar:
  group: Tool Patterns
  order: 4
---

Tool schemas validate model arguments. Product services validate permissions and business state. Output schemas keep the result shape narrow before it returns to the model.

## Scenario

The agent can change a shipping address, but only before the order ships, only for the authenticated customer, and only to an address verified by the address service.

## Flow

| Layer | Catches |
| --- | --- |
| Zod input schema | malformed model arguments |
| service lookup | missing or unauthorized product records |
| business rules | shipped order, disabled account, policy limits |
| external validation | unverified address |
| output schema | accidental unsafe or inconsistent return values |
| audit/event log | why the action was allowed or denied |

## Example

```ts
import { createTool } from "@anvia/core";
import { z } from "zod";

export function createChangeShippingAddressTool(scope: SupportToolScope) {
  return createTool({
    name: "change_shipping_address",
    description: "Change the shipping address for an unshipped order owned by the user.",
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
        await scope.auditLog.record({
          actorId: scope.user.id,
          action: "order.change_address.denied",
          targetId: orderId,
          metadata: { reason: "address_unverified" },
        });

        return {
          orderId,
          status: "not_allowed",
          message: "Address could not be verified.",
        };
      }

      const order = await scope.services.orders.lookupForUser({
        orderId,
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
      });

      if (order.status !== "processing") {
        return {
          orderId,
          status: "not_allowed",
          message: "Order already shipped.",
        };
      }

      await scope.services.orders.changeAddress({
        orderId,
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
        address: verified.address,
        idempotencyKey: scope.idempotencyKey,
      });

      await scope.auditLog.record({
        actorId: scope.user.id,
        action: "order.change_address",
        targetId: orderId,
        metadata: { country: verified.address.country },
      });

      return {
        orderId,
        status: "updated",
        message: "Shipping address updated.",
      };
    },
  });
}
```

## Testing Boundary

Call tools directly in tests. A model run is not required to verify permission scope:

```ts
await changeShippingAddress.call({
  orderId: "A-100",
  address: validAddress,
});

expect(services.orders.lookupForUser).toHaveBeenCalledWith({
  orderId: "A-100",
  userId: "user_1",
  tenantId: "tenant_1",
});
```

## Failure Modes

- The schema validates shape but not business state.
- Service errors leak internal messages to the model.
- Tool throws for expected denial states instead of returning a typed denial.
- Output includes fields that should stay server-side.
- Tests only exercise the tool through a live model call.

## Next Patterns

- [Permissioned Tools](/docs/examples/permissioned-tools)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Testing Harness](/docs/examples/testing-harness)
