---
title: Retrieval Agent
description: The pattern for combining retrieval with an account-aware agent.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 2
---

A retrieval agent adds selected evidence to a run while the application keeps ownership of access rules and source freshness.

## Scenario

A customer asks whether an address can be changed after checkout. The agent should use support policy docs and account tools, not guess from memory.

## Example

```ts
export function createSupportAgent(scope: SupportAgentScope) {
  return new AgentBuilder("support", scope.model)
    .instructions(`
Answer using retrieved policy evidence when available.
Use account tools for customer-specific state.
Say when policy evidence is missing.
    `)
    .dynamicContext(scope.supportDocsIndex, {
      topK: 4,
      threshold: 0.72,
      filter: {
        productArea: "checkout",
        visibility: "public",
      },
      render: (item) => [
        `Title: ${item.metadata.title}`,
        `Updated: ${item.metadata.updatedAt}`,
        item.text,
      ].join("\n"),
    })
    .tools(createSupportTools(scope))
    .defaultMaxTurns(4)
    .build();
}
```

## Boundary Rule

Retrieval provides evidence. Tools provide current product state. The model should not treat retrieved docs as permission to read or change account data.

## Failure Modes

- Retrieval filter does not include tenant, visibility, or product area.
- The model answers from docs when a tool should check live state.
- Source metadata is missing, so bad answers cannot be debugged.
- `topK` is high enough to flood the prompt with weak evidence.

## Next Patterns

- [RAG Ingestion](/docs/examples/rag-ingestion)
- [Document Grounding](/docs/examples/document-grounding)
- [Support Agent](/docs/examples/support-agent)
