---
title: Human Input
description: A pattern for clarification, approval, and resumable human decisions.
section: examples
sidebar:
  group: Tool Patterns
  order: 5
---

Human input is for missing facts, approvals, and policy decisions that should not be guessed by the model. Treat human input as workflow state: persist the question, show it in a UI, and resume with an explicit answer.

## Scenario

The agent wants to cancel an order, but the user did not confirm whether they want store credit or a card refund. The model should ask, wait for the answer, then call the guarded cancellation tool.

## Flow

| Step | Owner |
| --- | --- |
| model requests missing decision | clarification tool |
| app persists pending prompt | product workflow |
| UI collects answer | application |
| runner resumes with answer | application |
| side-effect tool validates and writes | permissioned tool |

## Example

```ts
import { createTool } from "@anvia/core";
import { z } from "zod";

const askRefundPreference = createTool({
  name: "ask_refund_preference",
  description: "Ask the user how they want a refund handled before cancellation.",
  input: z.object({
    orderId: z.string(),
    options: z.array(z.enum(["store_credit", "card_refund"])),
  }),
  output: z.object({
    pendingInputId: z.string(),
    status: z.literal("waiting_for_user"),
  }),
  async execute({ orderId, options }) {
    const pending = await scope.humanInput.create({
      conversationId: scope.conversationId,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
      kind: "choice",
      title: "Refund preference",
      message: `How should order ${orderId} be refunded?`,
      options,
    });

    return {
      pendingInputId: pending.id,
      status: "waiting_for_user",
    };
  },
});
```

The later request resumes with the user's answer:

```ts
export async function resumeCancellation(input: ResumeCancellationInput) {
  const user = await input.auth.requireUser();
  const pending = await input.humanInput.resolveForUser({
    pendingInputId: input.pendingInputId,
    userId: user.id,
    value: input.preference,
  });

  const response = await input.agent
    .prompt([
      ...pending.messages,
      Message.user(`Use refund preference ${input.preference} for order ${pending.orderId}.`),
    ])
    .send();

  return { output: response.output };
}
```

Use the answer in a guarded side-effect tool:

```ts
const cancelOrder = createTool({
  name: "cancel_order",
  description: "Cancel an order using the confirmed refund preference.",
  input: z.object({
    orderId: z.string(),
    preference: z.enum(["store_credit", "card_refund"]),
  }),
  output: z.object({
    cancellationId: z.string(),
    status: z.literal("cancelled"),
  }),
  execute: (args) =>
    scope.services.orders.cancel({
      ...args,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
      idempotencyKey: scope.idempotencyKey,
    }),
});
```

## Failure Modes

- The model invents missing product facts.
- Approval is asked after the write already happened.
- Human questions are not persisted, so resumed runs lose state.
- The UI cannot distinguish clarification from approval.
- Resume requests do not re-check user and tenant ownership.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Streaming Events](/docs/examples/streaming-events)
- [Backoffice Agent](/docs/examples/backoffice-agent)
