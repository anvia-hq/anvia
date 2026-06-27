---
title: Tool approvals
description: Require human approval before sensitive tool execution.
section: advanced
sidebar:
  group: Tools and action safety
  order: 23
---

Approvals pause sensitive tool execution until application code returns a decision. Use them for high-risk side effects such as refunds, account changes, outbound messages, destructive actions, or operations that need human review.

Approvals are a runtime gate. They do not replace handler-level authorization, validation, idempotency, or audit logging.

## Tool-Level Approval Policy

Add an `approval` policy to a tool when the tool itself knows when approval is required:

```ts
import { createTool } from "@anvia/core";
import type { ToolApprovalPolicy, ToolApprovalsOptions } from "@anvia/core";
import { z } from "zod";

const refundInput = z.object({
  orderId: z.string(),
  amountCents: z.number().int().positive(),
  reason: z.string(),
});

const refundApproval = {
  when(ctx) {
    return ctx.args.amountCents > 5000;
  },
  reason(ctx) {
    return `Refund ${ctx.args.amountCents} cents for ${ctx.args.orderId}.`;
  },
  rejectMessage: "The refund was not approved.",
} satisfies ToolApprovalPolicy<z.infer<typeof refundInput>>;

const requestRefund = createTool({
  name: "request_refund",
  description: "Request a refund for an eligible order.",
  input: refundInput,
  approval: refundApproval,
  async execute(args) {
    await auth.requireRefundPermission(user.id, args.orderId);
    return refunds.createRequest(args);
  },
});
```

The `when(...)` function receives parsed and validated tool arguments. If it returns `false`, the tool runs normally. If it returns `true`, the runtime calls the approval handler configured on the prompt request.

## Request Approval Handler

Configure approval handling on the prompt request:

```ts
const approvals = {
  async handler(request) {
    const decision = await reviewerQueue.requestDecision({
      toolName: request.toolName,
      args: request.args,
      reason: request.reason,
      runId: request.run.runId,
      sessionId: request.run.sessionId,
    });

    if (decision.approved) {
      return { approved: true, reason: decision.reason };
    }

    return {
      approved: false,
      reason: decision.reason,
      rejectMessage: "A reviewer rejected this action.",
    };
  },
} satisfies ToolApprovalsOptions;

const session = agent.session(threadId, { userId: user.id });
const request = session.prompt(message).approvals(approvals);
const response = await request.send();
```

When approval is rejected, core returns the rejection message as the tool result and the agent can continue the conversation. The handler should persist reviewer decisions in your application system.

## Missing Approval Handler

If a tool requests approval and the prompt request has no approval handler, core throws `ToolApprovalRequiredError`.

```ts
import { ToolApprovalRequiredError } from "@anvia/core";

try {
  const response = await request.send();
  return response.output;
} catch (error) {
  if (error instanceof ToolApprovalRequiredError) {
    await approvalInbox.store(error.request);
    return "This action needs approval before it can continue.";
  }

  throw error;
}
```

Use this pattern when the first request should only create an approval task. Core does not provide a resume token for a paused run; your application must start the later continuation with an approval handler or use a runtime that keeps the approval handler pending until a decision arrives.

## Hook-Driven Approval

Hooks can request approval even when the tool does not declare an approval policy:

```ts
import { createHook } from "@anvia/core";

const approvalHook = createHook({
  onToolCall({ toolName, args, tool }) {
    if (toolName === "send_email" && args.includes("enterprise")) {
      return tool.requestApproval({
        reason: "Outbound email to enterprise customer.",
        rejectMessage: "The email was not sent.",
      });
    }
  },
});
```

Use hook-driven approvals for workflow policy that depends on the current run. Use tool-level approval for policy that belongs to the tool contract.

## Approval Context

Approval requests include:

- tool name
- parsed arguments
- raw JSON arguments
- provider tool call id when available
- internal call id
- run id
- agent id
- session id when the run uses memory
- run metadata
- reason and reject message when provided

Do not expose the whole request blindly to reviewers. Project it into a review UI that redacts private fields and explains the action clearly.

## Approval Checklist

Before shipping approvals, check:

- the handler persists decisions and reviewer identity
- rejection messages are safe for the model and user
- approved tools still enforce permissions
- side effects are idempotent or protected by business constraints
- missing handlers are mapped to product approval tasks
