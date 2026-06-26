---
title: Request Runner
description: The pattern for wrapping one route, action, job, or queue request.
section: examples
sidebar:
  group: Foundation Patterns
  order: 2
---

A request runner is the testable workflow function behind a route, server action, job, or queue worker. It receives product dependencies explicitly and returns a product-shaped result.

## Scenario

The same support workflow is called from an HTTP route, a retry job, and a test. The runner is the shared boundary, so every entrypoint gets the same validation, trace metadata, tool scope, and persistence behavior.

## Example

```ts
type SupportRunnerInput = {
  conversationId: string;
  message: string;
  channel: "web" | "email" | "job";
  auth: AuthService;
  conversations: ConversationStore;
  services: {
    orders: OrdersService;
    tickets: TicketsService;
  };
};

type SupportRunnerResult =
  | { ok: true; output: string; traceName: string }
  | { ok: false; error: "message_required" | "not_allowed" };

export async function runSupportTurn(
  input: SupportRunnerInput,
): Promise<SupportRunnerResult> {
  const message = input.message.trim();

  if (message.length === 0) {
    return { ok: false, error: "message_required" };
  }

  const user = await input.auth.requireUser();

  if (!user.permissions.includes("support:chat")) {
    return { ok: false, error: "not_allowed" };
  }

  const history = await input.conversations.loadMessages(input.conversationId);
  const agent = createSupportAgent({ user, services: input.services });

  const response = await agent
    .prompt([...history, Message.user(message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        channel: input.channel,
      },
    })
    .send();

  await input.conversations.append(input.conversationId, response.messages);

  return {
    ok: true,
    output: response.output,
    traceName: "support-chat",
  };
}
```

The route only maps transport details:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const result = await runSupportTurn({ ...body, channel: "web", auth, conversations, services });

  return result.ok
    ? Response.json({ output: result.output })
    : Response.json({ error: result.error }, { status: 400 });
}
```

The test calls the same runner:

```ts
it("rejects empty messages before loading history", async () => {
  const conversations = fakeConversations();

  const result = await runSupportTurn({
    conversationId: "conv_123",
    message: " ",
    channel: "web",
    auth: fakeAuth(),
    conversations,
    services: fakeServices(),
  });

  expect(result).toEqual({ ok: false, error: "message_required" });
  expect(conversations.loadMessages).not.toHaveBeenCalled();
});
```

## Why This Boundary Matters

The runner keeps every product concern in one place. Routes do not need to know how the agent is built. Tests do not need an HTTP server. Jobs do not accidentally skip persistence or trace metadata.

## Failure Modes

- Each route builds the agent slightly differently.
- Tests only cover HTTP status codes, not workflow behavior.
- Retry jobs bypass permissions or idempotency checks.
- Trace metadata differs by caller.

## Next Patterns

- [Agent Harness](/docs/examples/agent-harness)
- [Agent Structure](/docs/examples/agent-structure)
- [Testing Harness](/docs/examples/testing-harness)
