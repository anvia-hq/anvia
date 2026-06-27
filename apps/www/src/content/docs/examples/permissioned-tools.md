---
title: Permissioned Tools
description: Tools that expose product capabilities while keeping authorization, validation, audit, and output safety in application code.
section: examples
sidebar:
  group: Foundation Patterns
  order: 3
---

Permissioned tools are the model's narrow interface to your application. A tool schema validates model arguments, but authorization must come from request scope and service checks, not from values the model supplies.

## Scenario

A support agent can read orders, create tickets, and request refunds. The model can ask for those actions, but the app must enforce user, tenant, role, idempotency, approval, audit, and safe return shapes.

## Example

```ts
import { createTool, type ToolApprovalPolicy } from "@anvia/core";
import { z } from "zod";

const refundInput = z.object({
  orderId: z.string(),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1),
});

const refundApproval = {
  when(ctx) {
    return ctx.args.amountCents > 10_000;
  },
  reason(ctx) {
    return `Refund ${ctx.args.amountCents} cents for order ${ctx.args.orderId}.`;
  },
  rejectMessage: "The refund was not approved.",
} satisfies ToolApprovalPolicy<z.infer<typeof refundInput>>;

export function createSupportTools(scope: SupportToolScope) {
  const lookupOrder = createTool({
    name: "lookup_order",
    description: "Look up one order owned by the current customer.",
    input: z.object({
      orderId: z.string(),
    }),
    output: z.object({
      id: z.string(),
      status: z.string(),
      canChangeAddress: z.boolean(),
    }),
    async execute({ orderId }) {
      const order = await scope.services.orders.lookupForUser({
        orderId,
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
      });

      return {
        id: order.id,
        status: order.status,
        canChangeAddress: order.status === "processing",
      };
    },
  });

  const createTicket = createTool({
    name: "create_ticket",
    description: "Create a support ticket for the current customer.",
    input: z.object({
      subject: z.string().min(1),
      body: z.string().min(1),
      orderId: z.string().optional(),
    }),
    output: z.object({
      ticketId: z.string(),
      status: z.enum(["created", "not_allowed"]),
      message: z.string(),
    }),
    async execute(input) {
      await scope.authz.require("tickets:create");

      const ticket = await scope.services.tickets.createForUser({
        ...input,
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
      });

      await scope.auditLog.record({
        actorId: scope.user.id,
        action: "ticket.create",
        targetId: ticket.id,
        metadata: { orderId: input.orderId },
      });

      return {
        ticketId: ticket.id,
        status: "created",
        message: "Ticket created.",
      };
    },
  });

  const requestRefund = createTool({
    name: "request_refund",
    description: "Request a refund for an eligible order.",
    input: refundInput,
    output: z.object({
      refundId: z.string().optional(),
      status: z.enum(["queued", "not_allowed"]),
      message: z.string(),
    }),
    approval: refundApproval,
    async execute(args) {
      await scope.authz.require("orders:refund");

      const refund = await scope.services.refunds.requestForUser({
        ...args,
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
        idempotencyKey: scope.idempotencyKey,
      });

      await scope.auditLog.record({
        actorId: scope.user.id,
        action: "refund.request",
        targetId: args.orderId,
        metadata: { refundId: refund.id, amountCents: args.amountCents },
      });

      return {
        refundId: refund.id,
        status: "queued",
        message: "Refund request queued.",
      };
    },
  });

  return [lookupOrder, createTicket, requestRefund];
}
```

The model sees tool names, descriptions, schemas, and safe outputs. It does not get to choose the authenticated user, tenant, permission set, service transaction, or idempotency key.

## Permission Layers

| Layer | Responsibility |
| --- | --- |
| request scope | authenticated user, tenant, roles, feature flags |
| tool input schema | shape of model-supplied arguments |
| service authorization | whether the user can access or mutate the target record |
| business validation | whether the action is currently allowed |
| approval policy | whether a human or external policy must approve |
| audit log | who requested what, when, and with which product ids |
| output schema | safe result shape returned to the model |

## Failure Modes

- The tool accepts `userId`, `tenantId`, or role from the model.
- Prompt text says "only access this user's orders" but services do not enforce it.
- The tool returns full database records when the model only needs status fields.
- Expected denials throw raw service errors instead of returning safe typed results.
- Side-effect tools lack idempotency keys and audit records.

## Next Patterns

- [Agent App Flow](/docs/examples/agent-app-flow)
- [Tool Validation](/docs/examples/tool-validation)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
