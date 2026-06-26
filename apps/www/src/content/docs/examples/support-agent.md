---
title: Support Agent
description: A real-case pattern for customer support with history, retrieval, and account tools.
section: examples
sidebar:
  group: Real Cases
  order: 1
---

A support agent combines the foundation patterns: a request runner, scoped tools, conversation history, retrieval, trace metadata, and safe persistence.

## Scenario

A signed-in customer asks, "Where is order A-100 and can I change the address?"

## Example

```ts
export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages(input.conversationId);

  const agent = new AgentBuilder("support", input.model)
    .instructions(`
Answer support questions clearly.
Use account tools for customer-specific data.
Use retrieved support docs for policy.
Ask for missing details before guessing.
    `)
    .dynamicContext(input.supportDocsIndex, {
      topK: 4,
      threshold: 0.72,
      filter: { productArea: "checkout", visibility: "public" },
    })
    .tools(createSupportTools({ user, services: input.services }))
    .context(`Current customer plan: ${user.plan}`, "customer-plan")
    .defaultMaxTurns(4)
    .build();

  const response = await agent
    .prompt([...history, Message.user(input.message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
        channel: input.channel,
      },
    })
    .send();

  await input.conversations.append(input.conversationId, response.messages);
  return { ok: true as const, output: response.output };
}
```

## Tool Scope

```ts
export function createSupportTools(scope: SupportToolScope) {
  return [
    createLookupOrderTool(scope),
    createChangeAddressTool(scope),
    createTicketTool(scope),
  ];
}
```

## Failure Modes

- Order tools accept user ids from the model.
- Retrieval includes private drafts.
- History grows without summarization or memory policy.
- The route returns raw runtime data instead of product response shape.

## Next Patterns

- [Agent Harness](/docs/examples/agent-harness)
- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Tool Boundaries](/docs/examples/tool-boundaries)
