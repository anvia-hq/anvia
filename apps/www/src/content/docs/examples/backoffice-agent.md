---
title: Backoffice Agent
description: A real-case pattern for internal workflows with approvals and audit.
section: examples
sidebar:
  group: Real Cases
  order: 3
---

A backoffice agent helps internal users perform operational workflows. It must treat writes as guarded side effects.

## Scenario

An operations user asks the agent to refund an order, create a ticket, and notify finance.

## Example

```ts
export async function runBackofficeAction(input: BackofficeInput) {
  const operator = await input.auth.requireUser();
  await input.authz.require(operator, "backoffice:use_agent");

  const agent = new AgentBuilder("backoffice", input.model)
    .instructions(`
Use tools for operational actions.
Explain which actions were performed.
Do not perform destructive actions without approval.
    `)
    .tools(createBackofficeTools({
      operator,
      services: input.services,
      auditLog: input.auditLog,
      idempotencyKey: input.idempotencyKey,
    }))
    .defaultMaxTurns(5)
    .build();

  return agent
    .prompt(input.message)
    .withTrace({
      name: "backoffice-agent",
      userId: operator.id,
      metadata: { tenantId: operator.tenantId },
    })
    .send();
}
```

Guarded write tools record audit data:

```ts
await auditLog.record({
  actorId: operator.id,
  action: "refund.issue",
  targetId: orderId,
  idempotencyKey,
});
```

## Failure Modes

- Agent tools bypass normal admin permissions.
- Audit logs depend on the model's final answer.
- Retried runs duplicate writes.
- Approval state is not persisted.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Human Input](/docs/examples/human-input)
- [Production Readiness](/docs/examples/production-readiness)
