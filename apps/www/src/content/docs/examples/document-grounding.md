---
title: Document Grounding
description: The pattern for using retrieved evidence in model responses.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 3
---

Document grounding tells the model how to use evidence and what to do when evidence is missing.

## Scenario

The support agent retrieves two policy chunks. It should answer with the policy, cite the source titles, and avoid inventing unsupported rules.

## Example

```ts
const groundedSupportAgent = new AgentBuilder("support", model)
  .instructions(`
Use retrieved documents as evidence.
When a policy answer depends on retrieved docs, mention the source title.
If no retrieved document supports the answer, say you need to check the policy.
Do not cite account tools as policy sources.
  `)
  .dynamicContext(policyIndex, {
    topK: 3,
    threshold: 0.74,
    render: (doc) =>
      [
        `<source id="${doc.id}" title="${doc.metadata.title}">`,
        doc.text,
        "</source>",
      ].join("\n"),
  })
  .tools(createAccountTools(scope))
  .build();
```

The runner can preserve evidence for debugging:

```ts
const response = await groundedSupportAgent
  .prompt([...history, Message.user(input.message)])
  .withTrace({
    name: "support-policy-answer",
    metadata: { conversationId: input.conversationId },
  })
  .send();

await evidenceLog.record({
  conversationId: input.conversationId,
  answer: response.output,
  traceId: response.traceId,
});
```

## Failure Modes

- Source labels are omitted, so the model cannot cite or distinguish evidence.
- Retrieved docs are treated as live account state.
- Missing evidence produces a confident answer.
- Evidence logs do not connect to the final response.

## Next Patterns

- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Observability Loop](/docs/examples/observability-loop)
