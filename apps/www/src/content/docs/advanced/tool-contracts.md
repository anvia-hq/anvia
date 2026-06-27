---
title: Tool contracts
description: Define tool schemas, handlers, validation, and typed outputs.
section: advanced
sidebar:
  group: Tools and action safety
  order: 20
---

Tools are the boundary between model intent and product systems. A tool contract should say what the model can ask for, what the handler will do, what output the model receives, and which product permissions are enforced before any side effect happens.

Use `createTool(...)` for application tools. It turns a Zod input schema into a provider tool definition, validates model arguments before execution, optionally validates output, and gives the handler a typed argument object.

## Define A Tool

```ts
import { createTool } from "@anvia/core";
import { z } from "zod";

const getInvoiceInput = z.object({
  invoiceId: z.string().min(1).describe("The invoice id to inspect."),
});

const getInvoiceOutput = z.object({
  id: z.string(),
  status: z.enum(["draft", "open", "paid", "void"]),
  totalCents: z.number().int(),
});

export function createGetInvoiceTool(scope: BillingScope) {
  return createTool({
    name: "get_invoice",
    description: "Look up one invoice that belongs to the current user.",
    input: getInvoiceInput,
    output: getInvoiceOutput,
    async execute(args) {
      await scope.auth.requireInvoiceAccess(scope.user.id, args.invoiceId);

      const invoice = await scope.billing.getInvoice(args.invoiceId);

      return {
        id: invoice.id,
        status: invoice.status,
        totalCents: invoice.totalCents,
      };
    },
  });
}
```

The input schema constrains what the model may request. The handler still owns authorization and product correctness. Do not rely on the model or prompt instructions to enforce access.

## Handler Scope

Build tools inside a request or workflow scope when they need the current user, tenant, feature flags, service clients, or audit handles:

```ts
export function createSupportTools(scope: SupportToolScope) {
  return [
    createGetInvoiceTool(scope),
    createSearchOrdersTool(scope),
    createEscalationTool(scope),
  ];
}

const tools = createSupportTools({
  user,
  auth,
  billing,
  orders,
  audit,
});
```

This keeps global agents from reading mutable user state. A tool should be testable with fake services and a fake user.

## Names And Descriptions

Use short, action-oriented names such as `get_invoice`, `search_orders`, or `create_refund_request`. Tool names become part of the model-facing API, so changing them can affect behavior.

Descriptions should say when to use the tool and what it returns. Avoid hiding permission rules only in the description. Put permission checks in the handler.

## Validation Boundaries

Core validates tool input before `execute(...)` runs. At the lower-level `ToolSet.call(...)` boundary, invalid JSON raises `ToolJsonError`, and schema or handler failures are wrapped in `ToolCallError` before product code can return a normal result.

During agent prompt execution, tool errors are reported to `onToolError` and then passed back to the model as tool-result text unless the hook cancels the run. Use `onToolError` when a tool failure should stop normal execution instead of becoming model context.

When `output` is provided, core validates the handler result before returning it to the runtime. Use output schemas for stable structured results and for catching accidental internal fields before they reach the model.

## Runtime Context And Errors

Tool handlers receive parsed arguments and a `ToolCallContext`. The context can emit tool stream events for advanced runtimes, but it is not an authorization object. Pass user, tenant, service, audit, and feature-flag state through the tool factory that closes over your request scope.

The lower-level tool APIs expose these contracts for integration code:

- `ToolApprovalContext`, `ToolApprovalRequest`, `ToolApprovalDecision`, and `ToolApprovalsOptions` for human approval flows
- `ToolCallError`, `ToolJsonError`, and `ToolNotFoundError` for precise error mapping around `ToolSet.call(...)`
- `ToolOutput.content(...)`, `NormalizedToolOutput`, and `toolResultContentToText(...)` for structured text/image tool results

## Side Effects

A side-effect tool should be narrow and explicit:

```ts
const refundInput = z.object({
  orderId: z.string(),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1),
});

export function createRefundTool(scope: RefundScope) {
  return createTool({
    name: "request_refund",
    description: "Create a refund request after policy and permission checks.",
    input: refundInput,
    async execute(args) {
      await scope.auth.requireRefundPermission(scope.user.id, args.orderId);
      await scope.policy.assertRefundAllowed(args.orderId, args.amountCents);

      const refund = await scope.refunds.createRequest({
        orderId: args.orderId,
        amountCents: args.amountCents,
        reason: args.reason,
        requestedBy: scope.user.id,
      });

      await scope.audit.record("refund.requested", {
        refundId: refund.id,
        orderId: args.orderId,
      });

      return `Refund request ${refund.id} was created.`;
    },
  });
}
```

Use approvals for high-risk side effects, but do not make approval the only safety check. The handler must still validate the operation.

## Testing Tools

Test tool handlers without the agent first. Call the tool directly with typed arguments and fake services:

```ts
const tool = createGetInvoiceTool(fakeScope);
const result = await tool.call({ invoiceId: "inv_123" });

expect(result.status).toBe("paid");
```

Then add agent-level tests for whether the model chooses the right tool and whether the runner maps tool failures safely.

## Contract Checklist

Before exposing a tool to an agent, check:

- the input schema is narrow and documented
- the handler enforces user and tenant permissions
- side effects are idempotent or audited
- private service errors are mapped before returning to users
- output does not expose internal-only fields
- the tool can be tested without a provider call
