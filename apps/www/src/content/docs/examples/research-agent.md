---
title: Research Agent
description: A real-case pattern for research, evidence collection, and synthesis.
section: examples
sidebar:
  group: Real Cases
  order: 2
---

A research agent should separate evidence collection from synthesis. Read-only tools gather sources; the final answer explains what is known and what is uncertain.

## Scenario

An analyst asks for a market brief. The agent can search internal notes, read approved sources, and produce a cited summary.

## Example

```ts
const researchAgent = new AgentBuilder("research", model)
  .instructions(`
Collect evidence before writing.
Cite source ids from retrieved notes or search tools.
Separate findings from assumptions.
  `)
  .tools([
    createSearchInternalNotesTool(scope),
    createReadApprovedSourceTool(scope),
  ])
  .defaultMaxTurns(6)
  .build();

export async function runResearchBrief(input: ResearchBriefInput) {
  const response = await researchAgent
    .prompt(`Research topic: ${input.topic}\nAudience: ${input.audience}`)
    .withTrace({
      name: "research-brief",
      userId: input.user.id,
      metadata: { tenantId: input.user.tenantId },
    })
    .send();

  await input.reports.save({
    topic: input.topic,
    output: response.output,
    requestedBy: input.user.id,
  });

  return { output: response.output };
}
```

## Failure Modes

- Search tools can write or mutate data.
- Final synthesis omits source ids.
- The agent treats weak search snippets as confirmed facts.
- Long research is run in the request path instead of a worker.

## Next Patterns

- [Pipeline Worker](/docs/examples/pipeline-worker)
- [Document Grounding](/docs/examples/document-grounding)
- [Multi-agent Coordination](/docs/examples/multi-agent-coordination)
