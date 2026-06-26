---
title: Guarded Side Effects
description: The pattern for approvals, idempotency, audit records, and restricted writes.
section: examples
sidebar:
  group: Tool Patterns
  order: 3
---

Side-effect tools change the world: refunds, cancellations, emails, database updates, deployments, and account changes. They need app-owned guardrails.

## Scenario

A backoffice agent can refund an order. The operation requires permission, an idempotency key, a human approval for large refunds, and an audit record.

## Example

```ts
const issueRefund = createTool({
  name: "issue_refund",
  description: "Issue a refund for an order after policy checks.",
  input: z.object({
    orderId: z.string(),
    amountCents: z.number().int().positive(),
    reason: z.string(),
  }),
  output: z.object({
    refundId: z.string(),
    status: z.enum(["approved", "queued"]),
  }),
  approval: ({ amountCents }) =>
    amountCents > 10_000
      ? { required: true, reason: "Refunds over $100 require approval." }
      : { required: false },
  async execute(input) {
    await scope.authz.require("orders:refund");

    const refund = await scope.services.refunds.issue({
      ...input,
      tenantId: scope.user.tenantId,
      requestedBy: scope.user.id,
      idempotencyKey: scope.idempotencyKey,
    });

    await scope.auditLog.record({
      actorId: scope.user.id,
      action: "refund.issue",
      targetId: input.orderId,
      metadata: { refundId: refund.id, amountCents: input.amountCents },
    });

    return { refundId: refund.id, status: refund.status };
  },
});
```

## Boundary Rule

The model may propose the action. The application decides whether the action is allowed, approved, idempotent, persisted, and auditable.

## Failure Modes

- A retry creates duplicate refunds.
- Approval is requested in prompt text instead of enforced by the tool.
- Audit records are written only after the model's final answer.
- Tool returns sensitive payment data the model does not need.

## Next Patterns

- [Human Input](/docs/examples/human-input)
- [Tool Validation](/docs/examples/tool-validation)
- [Backoffice Agent](/docs/examples/backoffice-agent)
