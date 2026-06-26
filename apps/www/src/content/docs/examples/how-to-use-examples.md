---
title: How to Use Examples
description: How to read the examples section as a pattern library.
section: examples
sidebar:
  group: Start Here
  order: 1
---

Use Examples when you are shaping product code around Anvia. A page should show a scenario, a module boundary, and the TypeScript shape for the pattern.

## Scenario

A support product has a chat endpoint. Users ask account-specific questions, the agent can read order data through tools, conversation history must be saved, and traces must identify the user and tenant.

This section keeps returning to that kind of app-shaped problem instead of showing isolated scripts.

## Pattern Example

```ts
// Good: product workflow is visible and testable.
export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages(input.conversationId);

  const agent = createSupportAgent({
    user,
    services: input.services,
  });

  const response = await agent
    .prompt([...history, Message.user(input.message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .send();

  await input.conversations.append(input.conversationId, response.messages);
  return { output: response.output };
}
```

```ts
// Avoid: route code owns every concern inline.
export async function POST(request: Request) {
  const body = await request.json();
  const agent = new AgentBuilder("support", model)
    .instructions(`User ${body.userId} can only see their own orders.`)
    .build();

  return Response.json(await agent.prompt(body.message).send());
}
```

The first version makes ownership visible. The second hides auth, persistence, tool scope, and trace metadata inside transport code or prompt text.

## What Belongs Here

| Content type | Purpose |
| --- | --- |
| pattern pages | show one reusable application boundary |
| real cases | combine several patterns into a product workflow |
| checklists | show what must be true before production |
| code shapes | make data flow and ownership concrete |

## What to Look For

- Where does the route stop?
- Which function can be unit-tested without HTTP?
- Which values are request-scoped?
- Which tools enforce permissions?
- Where are messages, events, and audit records persisted?
- Which trace metadata will help debug the run later?
