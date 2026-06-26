---
title: Production guardrails
description: Control permissions, side effects, retries, and unsafe actions.
section: advanced
sidebar:
  group: Quality and operations
  order: 53
---

Production guardrails belong at the boundary they protect. Instructions can guide the model, but product code must enforce permissions, side effects, idempotency, audit records, and latency policy.

Use the runtime controls in core with app-owned policy. Do not put product safety only in prompt text.

## Turn Limits

Set conservative defaults:

```ts
const agent = new AgentBuilder("support", model)
  .instructions("Use tools only when account data is required.")
  .tools(supportTools)
  .defaultMaxTurns(3)
  .build();

const request = agent.prompt(message).maxTurns(2);
const response = await request.send();
```

If a workflow regularly needs many turns, consider a pipeline, a narrower tool, or a more explicit task split.

## Permission Checks

Permission checks belong in tools or services:

```ts
async function lookupOrder(input: { orderId: string }) {
  await orders.requireAccess({
    userId: scope.user.id,
    tenantId: scope.user.tenantId,
    orderId: input.orderId,
  });

  return orders.find(input.orderId);
}
```

The model can decide whether to request an operation. It should not decide whether the actor is allowed to perform it.

## Hooks And Approvals

Use hooks for run-time control decisions:

```ts
import { createHook, requestToolApproval } from "@anvia/core";

const approvalHook = createHook({
  onToolCall({ toolName }) {
    if (toolName !== "issue_refund") {
      return;
    }

    return requestToolApproval({
      reason: "Refunds require reviewer approval.",
    });
  },
});

const agent = new AgentBuilder("support", model)
  .tools(refundTools)
  .hook(approvalHook)
  .approvals({
    handler: approvalRuntime.decide,
  })
  .build();
```

The approval runtime should live in your application. It owns reviewer identity, storage, notifications, timeout policy, and audit records.

## Idempotent Side Effects

Tools that write product state should call services with an operation id or transaction boundary:

```ts
await billing.issueRefund({
  userId: scope.user.id,
  tenantId: scope.user.tenantId,
  orderId,
  amount,
  operationId,
});
```

The model should not invent the idempotency key. Generate it in app code from trusted request state.

## Timeouts And Retries

Use app-level timeouts around routes and jobs. Use retries only when the operation is safe to retry.

Retrying a read-only provider call may be fine. Retrying a refund, deletion, email send, or external write requires idempotency or a durable operation record.

For long workflows, enqueue a job and let a worker own retries and status updates. Do not hide retry policy inside a prompt.

## Audit Records

Trace data helps debug runtime behavior. Audit records prove product decisions:

```ts
await audit.write({
  actorId: scope.user.id,
  tenantId: scope.user.tenantId,
  action: "refund.requested",
  targetId: orderId,
  operationId,
});
```

Store audit records in product storage with retention and access policy appropriate for the business action.

## Sensitive Streams

Streaming routes should filter events before sending them to a browser. Tool arguments, tool results, reasoning content, provider metadata, and retrieved documents can contain private data.

Expose only the event shapes the UI needs. Keep full runtime events in traces or event stores with the right access control.

## Guardrail Checklist

Before launch, confirm:

- every agent has a turn limit
- sensitive tools check permissions in code
- side-effect tools are idempotent or transactional
- approval paths cover accept, reject, and timeout
- retries are safe for the operation being retried
- trace metadata is safe to store
- audit records exist for sensitive product actions
