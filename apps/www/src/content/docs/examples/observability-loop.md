---
title: Observability Loop
description: The pattern for connecting traces, events, logs, and evals.
section: examples
sidebar:
  group: Quality and Operations
  order: 2
---

Observability should connect one product request across traces, runtime events, logs, and eval outcomes.

## Scenario

A support answer is wrong. The team needs to see the user, tenant, retrieved docs, tool calls, final answer, and whether a regression eval caught it.

## Example

```ts
const response = await agent
  .prompt([...history, Message.user(input.message)])
  .withTrace({
    name: "support-chat",
    userId: user.id,
    metadata: {
      tenantId: user.tenantId,
      conversationId: input.conversationId,
      channel: input.channel,
      release: input.release,
    },
  })
  .send();

await runEvents.append({
  conversationId: input.conversationId,
  traceName: "support-chat",
  output: response.output,
  usage: response.usage,
});
```

Log app-owned decisions separately:

```ts
logger.info({
  event: "support_tool_allowed",
  userId: user.id,
  tenantId: user.tenantId,
  tool: "lookup_order",
  orderId: input.orderId,
});
```

## Failure Modes

- Trace metadata omits tenant or conversation id.
- Tool permission decisions are not logged.
- Eval failures cannot be linked back to prompts or traces.
- Runtime events are stored without product ids.

## Next Patterns

- [Streaming Events](/docs/examples/streaming-events)
- [Eval Loop](/docs/examples/eval-loop)
