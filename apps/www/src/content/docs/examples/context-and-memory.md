---
title: Context and Memory
description: The pattern for assembling prompt context, history, retrieval, and durable memory.
section: examples
sidebar:
  group: Foundation Patterns
  order: 4
---

Context and memory decide what the model can use during a run. The pattern is to put each kind of information in the narrowest reliable channel.

## Scenario

A customer asks, "Can I change the shipping address for A-100 like last time?" The agent needs current account context, prior conversation, support policy, and fresh order state.

## Example

```ts
export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages(input.conversationId);
  const account = await input.services.accounts.getAccount(user.accountId);

  const agent = createSupportAgent({
    model,
    user,
    services: input.services,
  })
    .context(`Current account plan: ${account.plan}`, "account-plan")
    .context(`Support channel: ${input.channel}`, "support-channel")
    .build();

  return agent
    .prompt([...history, Message.user(input.message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .send();
}
```

Fresh order state stays behind a tool:

```ts
const lookupOrder = createTool({
  name: "lookup_order",
  description: "Look up one order that belongs to the current user.",
  input: z.object({ orderId: z.string() }),
  output: z.object({
    id: z.string(),
    status: z.string(),
    canChangeAddress: z.boolean(),
  }),
  execute: ({ orderId }) =>
    scope.services.orders.lookupForUser({
      orderId,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
    }),
});
```

## Channel Guide

| Channel | Use it for |
| --- | --- |
| instructions | stable behavior and constraints |
| `.context(...)` | small request facts already known by the app |
| message history | prior turns in this conversation |
| memory | durable session facts across turns |
| retrieval | selected documents or policy evidence |
| tools | fresh product state, permissions, writes, expensive reads |

## Why This Boundary Matters

Putting everything into the prompt creates stale, oversized, and unsafe context. Tools and retrieval keep changing data behind app-owned permission checks, while history and memory keep conversational continuity explicit.

## Failure Modes

- Current order state is saved in memory instead of read through a tool.
- Tenant filtering is applied after retrieval instead of before.
- Instructions include per-user facts.
- Full product records are attached when two fields would work.

## Next Patterns

- [RAG Ingestion](/docs/examples/rag-ingestion)
- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Tool Boundaries](/docs/examples/tool-boundaries)
