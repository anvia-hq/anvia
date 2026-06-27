---
title: Backoffice Agent
description: A real-case internal workflow with guarded writes, approvals, idempotency, and audit.
section: examples
sidebar:
  group: Real Cases
  order: 3
---

A backoffice agent helps internal users perform operational workflows. It can read product state, propose actions, and call guarded side-effect tools, but normal admin permissions and audit requirements still apply.

## Scenario

An operations user asks the agent to refund an order, create a ticket, and notify finance. Refunds over a threshold require approval, every write needs an idempotency key, and every action must be auditable.

## Flow

| Step | Pattern |
| --- | --- |
| authorize operator | Agent App Flow |
| compose operational tools | Permissioned Tools |
| guard writes | Guarded Side Effects |
| request approval | Human Input / Tool Approvals |
| persist audit | Runtime State and Persistence |

## Example

```ts
import { AgentBuilder } from "@anvia/core";

export async function runBackofficeAction(input: BackofficeInput) {
  const operator = await input.auth.requireUser();
  await input.authz.require(operator, "backoffice:use_agent");

  const agent = new AgentBuilder("backoffice", input.model)
    .instructions(`
Use tools for operational actions.
Explain which actions were performed and which were denied.
Do not perform destructive actions without approval.
Never rely on prompt text for permissions.
    `)
    .tools(createBackofficeTools({
      operator,
      services: input.services,
      auditLog: input.auditLog,
      authz: input.authz,
      idempotencyKey: input.idempotencyKey,
    }))
    .defaultMaxTurns(5)
    .build();

  const response = await agent
    .prompt(input.message)
    .withTrace({
      name: "backoffice-agent",
      userId: operator.id,
      metadata: {
        tenantId: operator.tenantId,
        operatorId: operator.id,
        requestId: input.requestId,
      },
    })
    .approvals(input.approvals)
    .send();

  await input.runRecords.record({
    requestId: input.requestId,
    operatorId: operator.id,
    traceId: response.trace?.traceId,
    output: response.output,
  });

  return { output: response.output };
}
```

Guarded write tools record audit data inside execution:

```ts
await auditLog.record({
  actorId: operator.id,
  action: "refund.issue",
  targetId: orderId,
  idempotencyKey,
  metadata: { amountCents, refundId },
});
```

## Production Checks

- Admin permission checks live in services/tools, not prompt text.
- Approval decisions are persisted with reviewer identity.
- Retried runs reuse idempotency keys.
- Tool outputs omit private payment and internal finance data.
- Run records link trace id, operator id, request id, and audit ids.

## Failure Modes

- Agent tools bypass normal admin permissions.
- Audit logs depend on the model's final answer.
- Retried runs duplicate writes.
- Approval state is not persisted.
- Rejection messages leak internal policy or payment details.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Human Input](/docs/examples/human-input)
- [Production Readiness](/docs/examples/production-readiness)
