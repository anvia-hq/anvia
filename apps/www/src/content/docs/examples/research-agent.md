---
title: Research Agent
description: A real-case research workflow with evidence collection, synthesis, citations, and background execution.
section: examples
sidebar:
  group: Real Cases
  order: 2
---

A research agent should separate evidence collection from synthesis. Read-only tools gather sources; the final answer explains what is known, what is uncertain, and which sources support each claim.

## Scenario

An analyst asks for a market brief. The workflow searches internal notes, reads approved sources, optionally asks specialists, and produces a cited summary as a background report.

## Flow

| Step | Pattern |
| --- | --- |
| enqueue report | Pipeline Worker |
| collect sources | Retrieval Agent and read-only tools |
| ask specialists | Multi-agent Coordination |
| synthesize answer | Agent Runtime Composition |
| save report/evidence | Runtime State and Persistence |

## Example

```ts
import { AgentBuilder } from "@anvia/core";

export function createResearchAgent(scope: ResearchAgentScope) {
  return new AgentBuilder("research", scope.model)
    .instructions(`
Collect evidence before writing.
Cite source ids from retrieved notes or search tools.
Separate findings from assumptions.
If sources disagree, explain the disagreement.
    `)
    .tools([
      createSearchInternalNotesTool(scope),
      createReadApprovedSourceTool(scope),
      createAskPolicySpecialistTool(scope),
    ])
    .defaultMaxTurns(8)
    .build();
}

export async function runResearchBrief(input: ResearchBriefInput) {
  const user = await input.auth.requireUser();
  const agent = createResearchAgent({
    model: input.model,
    user,
    sources: input.sources,
    notesIndex: input.notesIndex,
  });

  const response = await agent
    .prompt([
      `Research topic: ${input.topic}`,
      `Audience: ${input.audience}`,
      "Return a brief with findings, assumptions, and cited source ids.",
    ].join("\n"))
    .withTrace({
      name: "research-brief",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        reportId: input.reportId,
        topic: input.topic,
      },
    })
    .send();

  await input.reports.save({
    reportId: input.reportId,
    topic: input.topic,
    output: response.output,
    requestedBy: user.id,
    traceId: response.trace?.traceId,
  });

  return { output: response.output };
}
```

## Source Tool Boundary

```ts
const readApprovedSource = createTool({
  name: "read_approved_source",
  description: "Read an approved source by id.",
  input: z.object({ sourceId: z.string() }),
  output: z.object({
    sourceId: z.string(),
    title: z.string(),
    excerpt: z.string(),
  }),
  execute: ({ sourceId }) =>
    scope.sources.readForUser({
      sourceId,
      userId: scope.user.id,
      tenantId: scope.user.tenantId,
    }),
});
```

Research tools should be read-only unless the page is explicitly about publishing or filing a report.

## Failure Modes

- Search tools can write or mutate data.
- Final synthesis omits source ids.
- The agent treats weak search snippets as confirmed facts.
- Long research is run in the request path instead of a worker.
- Evidence is saved only inside prose and cannot be audited.

## Next Patterns

- [Pipeline Worker](/docs/examples/pipeline-worker)
- [Document Grounding](/docs/examples/document-grounding)
- [Multi-agent Coordination](/docs/examples/multi-agent-coordination)
