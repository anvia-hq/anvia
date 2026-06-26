---
title: Agent Harness
description: The request boundary around one Anvia agent run.
section: examples
sidebar:
  group: Foundation Patterns
  order: 1
---

An agent harness is the application-owned shell around one Anvia run. It accepts a product request, resolves product state, runs the agent, persists what happened, and returns a product response.

## Scenario

A signed-in customer asks, "Where is order A-100?" The app must authenticate the user, load conversation history, scope tools to the tenant, run the agent, save messages, and return only the answer the UI needs.

## Application Shape

```txt
src/
  routes/support.ts          # transport parsing and response shape
  ai/support-runner.ts       # one support chat workflow
  ai/support-agent.ts        # agent factory
  ai/support-tools.ts        # request-scoped tools
  storage/conversations.ts   # history and message persistence
  services/orders.ts         # permission-aware product data
```

## Example

```ts
// routes/support.ts
export async function POST(request: Request) {
  const body = await request.json();

  const result = await runSupportTurn({
    conversationId: body.conversationId,
    message: body.message,
    auth,
    conversations,
    services: { orders },
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ output: result.output });
}
```

```ts
// ai/support-runner.ts
import { Message } from "@anvia/core";
import { createSupportAgent } from "./support-agent";

export async function runSupportTurn(input: SupportTurnInput) {
  const message = input.message.trim();

  if (message.length === 0) {
    return { ok: false as const, error: "message_required" };
  }

  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages(input.conversationId);
  const agent = createSupportAgent({
    user,
    services: input.services,
  });

  const response = await agent
    .prompt([...history, Message.user(message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .send();

  await input.conversations.append(input.conversationId, response.messages);

  return {
    ok: true as const,
    output: response.output,
    usage: response.usage,
  };
}
```

## Why This Boundary Matters

| Application owns | Anvia owns |
| --- | --- |
| auth, tenant, service dependencies | model and tool loop |
| input validation and response shape | prompt execution |
| conversation persistence | response messages and usage |
| trace metadata policy | trace attachment point |
| product errors | runtime errors |

## Failure Modes

| Failure | Usually means |
| --- | --- |
| route creates tools directly | transport is doing harness work |
| permissions are in prompt text | tools or services are not enforcing them |
| history is appended in multiple places | persistence is not part of the harness |
| tests must start the HTTP server | the runner boundary is missing |

## Next Patterns

- [Request Runner](/docs/examples/request-runner)
- [Agent Structure](/docs/examples/agent-structure)
- [Tool Boundaries](/docs/examples/tool-boundaries)
