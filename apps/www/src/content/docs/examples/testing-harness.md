---
title: Testing Harness
description: A pattern for testing deterministic boundaries around model-dependent behavior.
section: examples
sidebar:
  group: Quality and Operations
  order: 1
---

Test deterministic boundaries before relying on live model behavior. Runners, tools, permission checks, retrieval filters, persistence, and stream reducers should be testable with fakes.

## Scenario

The support runner must reject empty messages, scope order tools to the signed-in user, filter retrieval by tenant, and append messages only after success.

## Flow

| Test target | Use |
| --- | --- |
| runner | fake auth, fake model, fake stores |
| tools | call `tool.call(...)` directly |
| retrieval filters | fake index or inspect search request |
| streaming UI | reducer tests with synthetic events |
| side effects | fake services and audit log |

## Example

```ts
it("rejects empty messages before model execution", async () => {
  const model = fakeCompletionModel();
  const conversations = fakeConversations();

  const result = await runSupportTurn({
    conversationId: "conv_1",
    message: " ",
    auth: fakeAuth({ userId: "user_1", tenantId: "tenant_1" }),
    conversations,
    services: fakeServices(),
    supportDocsIndex: fakeVectorIndex(),
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
    auditLog: fakeAuditLog(),
  });

  await lookupOrder.call({ orderId: "A-100" });

  expect(services.orders.lookupForUser).toHaveBeenCalledWith({
    orderId: "A-100",
    userId: "user_1",
    tenantId: "tenant_1",
  });
});
```

Retrieval tests should assert filters before model output:

```ts
it("filters support docs by tenant and visibility", async () => {
  const index = recordingVectorIndex();

  await runSupportTurn({
    ...fakeSupportInput(),
    supportDocsIndex: index,
  });

  expect(index.searchRequests[0]).toMatchObject({
    topK: 4,
    filter: expect.any(Object),
  });
});
```

Streaming reducers are deterministic:

```ts
const state = reduceSupportEvent(initialState, {
  type: "tool_result",
  turn: 1,
  toolName: "lookup_order",
  internalCallId: "tool_1",
  args: "{}",
  result: "Order found",
});

expect(state.activity).toContain("lookup_order returned");
```

## Failure Modes

- Tests only assert final model text.
- Tool tests require real databases.
- Permission failures are tested through prompt wording.
- Streaming reducers are not tested with tool events.
- Retrieval filters are only checked by reading final answers.

## Next Patterns

- [Eval Loop](/docs/examples/eval-loop)
- [Production Readiness](/docs/examples/production-readiness)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
