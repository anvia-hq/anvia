---
title: Testing Harness
description: The pattern for testing deterministic boundaries around model-dependent behavior.
section: examples
sidebar:
  group: Quality and Operations
  order: 1
---

Test the deterministic boundary before relying on live model behavior. Runners, tools, permission checks, persistence, and event reducers should be testable with fakes.

## Scenario

The support runner must reject empty messages, scope order tools to the user, and append messages after success.

## Example

```ts
it("rejects empty messages before model execution", async () => {
  const model = fakeModel();
  const conversations = fakeConversations();

  const result = await runSupportTurn({
    conversationId: "conv_1",
    message: " ",
    auth: fakeAuth({ userId: "user_1" }),
    conversations,
    services: fakeServices(),
    model,
  });

  expect(result).toEqual({ ok: false, error: "message_required" });
  expect(model.requests).toHaveLength(0);
  expect(conversations.append).not.toHaveBeenCalled();
});
```

Tool tests should call the tool directly:

```ts
it("looks up orders through the scoped service", async () => {
  const services = fakeServices();
  const [lookupOrder] = createSupportTools({
    user: fakeUser({ id: "user_1", tenantId: "tenant_1" }),
    services,
  });

  await lookupOrder.call({ orderId: "A-100" });

  expect(services.orders.lookupForUser).toHaveBeenCalledWith({
    orderId: "A-100",
    userId: "user_1",
    tenantId: "tenant_1",
  });
});
```

## Failure Modes

- Tests only assert final model text.
- Tool tests require real databases.
- Permission failures are tested through prompt wording.
- Streaming reducers are not tested with tool events.

## Next Patterns

- [Eval Loop](/docs/examples/eval-loop)
- [Production Readiness](/docs/examples/production-readiness)
