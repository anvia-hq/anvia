---
title: Retrieval Agent
description: A runtime retrieval flow that combines indexed evidence with permissioned account tools.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 2
---

A retrieval agent adds selected evidence to an agent run while the application keeps ownership of access rules and live product state. Retrieval answers policy questions; tools answer account-specific questions.

## Scenario

A customer asks whether an address can be changed after checkout. The agent should use published checkout policy from the Chroma index and use account tools for the current order state.

## Flow

| Step | Boundary |
| --- | --- |
| runner authenticates user | app |
| runner passes prepared `supportDocsIndex` | app startup or ingestion job |
| dynamic context searches policy evidence | Anvia runtime |
| account tools read current order state | app services |
| final answer separates policy from live account state | agent instructions and tool results |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

export function createCheckoutSupportAgent(scope: CheckoutSupportScope) {
  const retrievalFilter = vectorFilter.and(
    vectorFilter.and(
      vectorFilter.eq("tenantId", scope.user.tenantId),
      vectorFilter.eq("productArea", "checkout"),
    ),
    vectorFilter.eq("visibility", "public"),
  );

  return new AgentBuilder("checkout-support", scope.model)
    .instructions(`
Use retrieved policy evidence for policy answers.
Use account tools for current order state.
If retrieved evidence is missing, say the policy needs to be checked.
Never treat retrieved policy as permission to read or change account data.
    `)
    .dynamicContext(scope.supportDocsIndex, {
      topK: 4,
      threshold: 0.72,
      filter: retrievalFilter,
      format: (result) => ({
        id: result.id,
        text: [
          `<policy-source id="${result.id}" title="${result.metadata?.title ?? "Untitled"}">`,
          `Source: ${result.metadata?.source ?? "unknown"}`,
          `Updated: ${result.metadata?.updatedAt ?? "unknown"}`,
          result.metadata?.pageNumber !== undefined
            ? `Page: ${result.metadata.pageNumber}`
            : undefined,
          "",
          String(result.document),
          "</policy-source>",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    })
    .tools(createSupportTools(scope))
    .defaultMaxTurns(4)
    .build();
}

export async function runCheckoutSupportTurn(input: CheckoutSupportInput) {
  const user = await input.auth.requireUser();
  const agent = createCheckoutSupportAgent({
    model: input.model,
    user,
    supportDocsIndex: input.supportDocsIndex,
    services: input.services,
  });

  const response = await agent
    .prompt(input.message)
    .withTrace({
      name: "checkout-support",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .send();

  return {
    answer: response.output,
    traceId: response.trace?.traceId,
  };
}
```

## Search Tool Variant

Use a retrieval tool when the model should decide whether to search or refine the query:

```ts
const searchSupportDocs = supportDocsIndex.asTool({
  name: "search_support_docs",
  description: "Search published checkout support policy.",
  topK: 4,
  threshold: 0.72,
  filter: retrievalFilter,
});

const agent = new AgentBuilder("checkout-support", model)
  .instructions("Search support docs before answering policy questions.")
  .tool(searchSupportDocs)
  .tools(createSupportTools(scope))
  .defaultMaxTurns(4)
  .build();
```

Dynamic context is a better default when every answer should receive likely policy evidence. A search tool is useful when retrieval is occasional or the model needs to try a more specific query after a tool result.

## Boundary Rule

Retrieval provides evidence. Tools provide current product state and actions. The model should not answer "your order can be changed" from policy alone; it should call an order tool to check the actual order status.

## Failure Modes

- Retrieval filters omit tenant, visibility, product area, or access tier.
- The model answers from docs when a tool should check live state.
- Source formatting hides titles, dates, or page numbers needed for citations.
- The same sensitive record is exposed through both retrieval and tools with different permission rules.

## Next Patterns

- [RAG Ingestion](/docs/examples/rag-ingestion)
- [Document Grounding](/docs/examples/document-grounding)
- [Support Agent](/docs/examples/support-agent)
