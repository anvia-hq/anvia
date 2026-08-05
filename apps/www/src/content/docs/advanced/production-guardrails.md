---
title: Production guardrails
description: Enforce input and output policy around agent runs.
section: advanced
sidebar:
  group: Quality and operations
  order: 57
---

Guardrails are runtime policy checks around agent text boundaries. They can block or
rewrite unsafe input before model work, and they can sanitize final output before it is
returned, streamed, or committed to memory.

Guardrails do not replace product authorization, idempotency, audit records, or service-level validation. Keep those checks in your tools and services.

The mental model is simple: guardrails decide automatically, approvals ask a person or
external workflow, and tools/services enforce product truth.

## Guardrails Or Approvals

Use guardrails when policy can run automatically from runtime context. They are best for
model-boundary text decisions: redact secrets, block unsafe input, or sanitize final
assistant output.

Use tool approvals when the next step is a decision from a human or external reviewer.
Approval means the runtime may attempt the tool call. It does not mean the business
operation is authorized or valid.

## Policy Setup

```ts
import {
  AgentBuilder,
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
} from "@anvia/core";

const redactInput = defineInputGuardrail({
  id: "redact-card-numbers",
  check(ctx, { allow, rewrite }) {
    const inputText = ctx.inputText.replace(/\b\d{16}\b/g, "[redacted]");
    return inputText === ctx.inputText
      ? allow()
      : rewrite({ inputText, reason: "card_number_redacted" });
  },
});

const redactOutput = defineOutputGuardrail({
  id: "redact-output-secrets",
  check(ctx, { allow, rewrite }) {
    const outputText = ctx.outputText.replace(/token=[^\s]+/gi, "token=[redacted]");
    return outputText === ctx.outputText
      ? allow()
      : rewrite({ outputText, reason: "secret_redacted" });
  },
});

const policy = defineGuardrailPolicy({
  id: "support-production",
  input: [redactInput],
  output: [redactOutput],
});

const agent = new AgentBuilder("support", model)
  .tools(supportTools)
  .guardrails(policy)
  .approvals({ handler: approvalRuntime.decide })
  .defaultMaxTurns(3)
  .build();
```

## Boundaries

Input guardrails run before memory and model work. Output guardrails run before final
responses are returned, streamed, or committed to memory.

During streaming, enforced output guardrails buffer text and reasoning deltas until the final output is checked. This prevents unsafe raw output from being emitted before redaction or blocking.

## Observe Mode

Use observe mode to measure policy impact before enforcing:

```ts
const policy = defineGuardrailPolicy({
  id: "support-observe",
  mode: "observe",
  output: [redactOutput],
});
```

Observe mode records guardrail decisions but does not block or rewrite.

## Side Effects Still Need Product Checks

```ts
const issueRefund = createTool({
  name: "issue_refund",
  description: "Issue a refund after policy checks.",
  input: refundInput,
  async execute(input) {
    await scope.authz.require(scope.operator, "orders:refund");

    return scope.refunds.issue({
      ...input,
      tenantId: scope.operator.tenantId,
      requestedBy: scope.operator.id,
      idempotencyKey: scope.idempotencyKey,
    });
  },
});
```

The model can request a tool call. Tool approvals can pause it. The service still decides
whether the actor can perform the operation and how duplicate writes are prevented.

## Decision Records

Prompt responses and final stream events include guardrail decisions. Streams also emit `guardrail_decision` events, and observers receive `guardrail.decision`.

Use these records for rollout review, alerting, and tests:

```ts
const response = await agent.prompt(message).send();

for (const decision of response.guardrails ?? []) {
  await audit.write({
    action: "guardrail.decision",
    targetId: decision.guardrailId,
    metadata: decision,
  });
}
```

## Guardrail Checklist

Before launch, confirm:

- every production agent has turn limits and relevant guardrail policies
- observe-mode decisions have been reviewed before enforcement
- sensitive tools still check permissions in code
- side-effect tools are idempotent or transactional
- approval handlers persist reviewer identity and timeout outcomes
- tool results and final stream events do not expose private fields
