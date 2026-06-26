---
title: Testing strategy
description: Test agents, tools, retrieval, streaming, and provider behavior.
section: advanced
sidebar:
  group: Quality and operations
  order: 52
---

Test the deterministic harness before testing model behavior. Most production bugs come from permissions, state, retrieval filters, side effects, persistence, and error mapping, not from prose quality alone.

Use fake models and fake services for fast tests. Use provider-backed smoke tests sparingly for capabilities that only the provider can prove.

## Test The Runner Boundary

A runner test should verify product behavior:

- validates input
- authenticates the actor
- builds request-scoped tools
- attaches safe trace metadata
- maps known runtime errors
- writes product records around the run

Keep the agent factory injectable so the runner can use fake models, fake memory stores, fake observers, and fake services.

## Test Tools Directly

Test high-risk tools without a model call:

```ts
const toolSet = createSupportTools({
  user,
  tenant,
  orders: fakeOrders,
  audit: fakeAudit,
});

const result = await toolSet.call(
  "lookup_order",
  JSON.stringify({ orderId: "A-100" }),
);

expect(JSON.parse(result)).toMatchObject({
  orderId: "A-100",
  status: "shipped",
});
```

This proves schema validation, permission checks, service behavior, and output shape before asking a model to choose the tool.

## Test Agents With Fake Models

Fake completion models are the fastest way to test runtime behavior:

```ts
import { AssistantContent, Usage } from "@anvia/core";
import type {
  CompletionModel,
  CompletionResponse,
} from "@anvia/core/completion";

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "queue";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: true,
    outputSchema: true,
    reasoning: false,
  };

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion() {
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("QueueModel has no response queued.");
    }
    return next;
  }
}

const model = new QueueModel([
  response([AssistantContent.toolCall("call_1", "lookup_order", { orderId: "A-100" })]),
  response([AssistantContent.text("Order A-100 shipped.")]),
]);

const agent = createSupportAgent({
  model,
  services: fakeServices,
  memory: fakeMemory,
});

const session = agent.session("test-conversation", {
  userId: user.id,
  metadata: { tenantId: user.tenantId },
});
const response = await session.prompt("Where is order A-100?").send();

expect(response.output).toContain("shipped");
```

This tests the model-tool loop without external provider latency.

## Test Retrieval Separately

Retrieval tests should prove selection and permissions before answer quality:

```ts
const results = await tenantDocsIndex.search({
  query: "refund policy",
  topK: 5,
  filter: vectorFilter.eq("tenantId", tenant.id),
});

expect(results.every((result) => result.metadata?.tenantId === tenant.id)).toBe(true);
```

After filters and chunking are correct, use evals to test whether retrieved context leads to good answers.

## Test Streaming

For streaming routes, test the event contract your UI receives:

```ts
const request = agent.prompt("Stream a short answer.");
const events = [];

for await (const event of request.stream()) {
  events.push(event.type);
}

expect(events).toContain("text_delta");
expect(events.at(-1)).toBe("final");
```

If browser clients receive filtered events, test the filter separately so tool arguments, tool results, reasoning content, and private metadata do not leak.

## Provider Smoke Tests

Keep provider tests small and workflow-specific:

- one text completion for credentials
- one streaming completion if the UI streams
- one forced tool-call workflow if tools are enabled
- one parsed completion if schemas are enabled
- one retrieval query if embedding/vector config changed

Run smoke tests on model id changes and deployment config changes. Use evals for quality regressions.

## Test Approvals And Guardrails

For high-risk workflows, cover:

- approval accepted
- approval rejected
- approval timeout
- hook cancellation
- max-turn failure
- idempotency on retried jobs
- audit record written for side effects

The model should not be the only thing that prevents a restricted action.
