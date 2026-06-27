---
title: Guarded Side Effects
description: A pattern for approvals, idempotency, audit records, and restricted writes.
section: examples
sidebar:
  group: Tool Patterns
  order: 3
---

Side-effect tools change the world: refunds, cancellations, emails, database updates, deployments, and account changes. The model may request the action, but application code decides whether it is allowed, approved, idempotent, persisted, and auditable.

## Scenario

A backoffice agent can refund an order. The operation requires operator permission, an idempotency key, human approval for large refunds, and an audit record written by the tool.

## Flow

| Guard | Where it lives |
| --- | --- |
| permission | authz service inside the tool |
| business validation | product service |
| approval | `ToolApprovalPolicy.when(...)` plus request approval handler |
| idempotency | product write service |
| audit | tool execution path |
| safe output | tool output schema |

## Example

```ts
import { createTool, type ToolApprovalPolicy, type ToolApprovalsOptions } from "@anvia/core";
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

export function createIssueRefundTool(scope: BackofficeToolScope) {
  return createTool({
    name: "issue_refund",
    description: "Issue a refund for an eligible order after policy checks.",
    input: refundInput,
    output: z.object({
      refundId: z.string().optional(),
      status: z.enum(["issued", "not_allowed"]),
      message: z.string(),
    }),
    approval: refundApproval,
    async execute(input) {
      await scope.authz.require(scope.operator, "orders:refund");

      const eligibility = await scope.services.refunds.checkEligibility({
        orderId: input.orderId,
        tenantId: scope.operator.tenantId,
      });

      if (!eligibility.ok) {
        return {
          status: "not_allowed",
          message: eligibility.publicReason,
        };
      }

      const refund = await scope.services.refunds.issue({
        ...input,
        tenantId: scope.operator.tenantId,
        requestedBy: scope.operator.id,
        idempotencyKey: scope.idempotencyKey,
      });

      await scope.auditLog.record({
        actorId: scope.operator.id,
        action: "refund.issue",
        targetId: input.orderId,
        idempotencyKey: scope.idempotencyKey,
        metadata: { refundId: refund.id, amountCents: input.amountCents },
      });

      return {
        refundId: refund.id,
        status: "issued",
        message: "Refund issued.",
      };
    },
  });
}

export const approvals = {
  async handler(request) {
    const decision = await reviewerQueue.requestDecision({
      toolName: request.toolName,
      args: request.args,
      reason: request.reason,
      runId: request.run.runId,
      operatorId: request.run.metadata?.operatorId,
    });

    return decision.approved
      ? { approved: true, reason: decision.reason }
      : {
          approved: false,
          reason: decision.reason,
          rejectMessage: "A reviewer rejected this action.",
        };
  },
} satisfies ToolApprovalsOptions;
```

Attach approvals at the request boundary:

```ts
const response = await agent
  .prompt(input.message)
  .withTrace({
    name: "backoffice-agent",
    userId: operator.id,
    metadata: { operatorId: operator.id, tenantId: operator.tenantId },
  })
  .approvals(approvals)
  .send();
```

## Failure Modes

- A retry creates duplicate refunds because no idempotency key reaches the service.
- Approval is requested in prompt text instead of enforced by the tool/runtime.
- Audit records are written only after the model's final answer.
- Tool returns sensitive payment data the model does not need.
- Expected denials throw raw provider or database errors.

## Next Patterns

- [Human Input](/docs/examples/human-input)
- [Tool Validation](/docs/examples/tool-validation)
- [Backoffice Agent](/docs/examples/backoffice-agent)
