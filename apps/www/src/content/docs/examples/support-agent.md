---
title: Support Agent
description: A real-case support workflow with history, retrieval, account tools, traces, and persistence.
section: examples
sidebar:
  group: Real Cases
  order: 1
---

A support agent combines the foundation patterns: a request runner, scoped tools, conversation history, retrieved policy evidence, trace metadata, safe persistence, and typed product responses.

## Scenario

A signed-in customer asks, "Where is order A-100 and can I change the address?" The answer needs live order state from tools and checkout policy from retrieval.

## Flow

| Step | Pattern |
| --- | --- |
| authenticate and load history | Agent App Flow |
| retrieve policy | Retrieval Agent |
| read/change account state | Permissioned Tools |
| persist messages and trace | Runtime State and Persistence |
| test and evaluate | Testing Harness and Eval Loop |

## Example

```ts
import { AgentBuilder, Message } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

export async function runSupportTurn(input: SupportTurnInput) {
  if (input.message.trim().length === 0) {
    return { ok: false as const, error: "message_required" };
  }

  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages({
    conversationId: input.conversationId,
    userId: user.id,
    tenantId: user.tenantId,
  });

  const agent = createSupportAgent({
    model: input.model,
    user,
    services: input.services,
    supportDocsIndex: input.supportDocsIndex,
    auditLog: input.auditLog,
    idempotencyKey: input.idempotencyKey,
  });

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

  await input.conversations.append({
    conversationId: input.conversationId,
    userId: user.id,
    messages: response.messages,
  });

  await input.runRecords.record({
    conversationId: input.conversationId,
    traceId: response.trace?.traceId,
    output: response.output,
    usage: response.usage,
  });

  return { ok: true as const, output: response.output };
}

export function createSupportAgent(scope: SupportAgentScope) {
  const publicCheckoutPolicy = vectorFilter.and(
    vectorFilter.and(
      vectorFilter.eq("tenantId", scope.user.tenantId),
      vectorFilter.eq("productArea", "checkout"),
    ),
    vectorFilter.eq("visibility", "public"),
  );

  return new AgentBuilder("support", scope.model)
    .instructions(`
Answer support questions clearly.
Use account tools for customer-specific data.
Use retrieved support docs for policy.
Ask for missing details before guessing.
Do not say an action succeeded unless a tool result says it succeeded.
    `)
    .dynamicContext(scope.supportDocsIndex, {
      topK: 4,
      threshold: 0.72,
      filter: publicCheckoutPolicy,
      format: (result) => ({
        id: result.id,
        text: [
          `<support-source id="${result.id}" title="${result.metadata?.title ?? "Untitled"}">`,
          String(result.document),
          "</support-source>",
        ].join("\n"),
      }),
    })
    .tools(createSupportTools(scope))
    .defaultMaxTurns(4)
    .build();
}
```

## Tool Scope

```ts
export function createSupportTools(scope: SupportAgentScope) {
  return [
    createLookupOrderTool(scope),
    createChangeShippingAddressTool(scope),
    createTicketTool(scope),
  ];
}
```

Each tool closes over `user`, `tenantId`, service handles, audit log, and idempotency key. None of those values should come from model arguments.

## Production Checks

- Support docs are ingested by [RAG Ingestion](/docs/examples/rag-ingestion) before runtime.
- Retrieval filters include tenant, product area, and visibility.
- Order tools enforce user ownership through services.
- Known denial states return safe typed messages.
- Conversations, run records, and audit logs are separate stores.

## Failure Modes

- Order tools accept user ids from the model.
- Retrieval includes private drafts.
- History grows without summarization or memory policy.
- The route returns raw runtime data instead of a product response shape.
- The answer cites account tool output as if it were support policy.

## Next Patterns

- [Agent App Flow](/docs/examples/agent-app-flow)
- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Permissioned Tools](/docs/examples/permissioned-tools)
