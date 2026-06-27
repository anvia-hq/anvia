---
title: Document Grounding
description: A grounding pattern for citations, missing evidence, and evidence logs.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 3
---

Document grounding tells the model how to use evidence and tells the application how to debug the answer later. Use source labels, missing-evidence behavior, and evidence logs together.

## Scenario

The support agent retrieves checkout policy chunks. It should answer with the policy, cite source titles or pages, avoid inventing unsupported rules, and let support engineers inspect which evidence was available.

## Flow

| Step | Purpose |
| --- | --- |
| search or dynamic context selects evidence | limits prompt to relevant docs |
| format source labels | gives the model citation handles |
| instructions define missing-evidence behavior | prevents confident unsupported answers |
| evidence log records selected docs | supports debugging, evals, and source fixes |

## Example

Use manual retrieval when the application needs an exact evidence log:

```ts
import { AgentBuilder, Message } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

export async function answerWithPolicyEvidence(input: GroundedPolicyInput) {
  const user = await input.auth.requireUser();
  const filter = vectorFilter.and(
    vectorFilter.eq("tenantId", user.tenantId),
    vectorFilter.eq("visibility", "public"),
  );

  const evidence = await input.policyIndex.search({
    query: input.message,
    topK: 4,
    threshold: 0.74,
    filter,
  });

  const agent = new AgentBuilder("grounded-support", input.model)
    .instructions(`
Use the provided policy sources as evidence.
Cite source ids or titles when policy affects the answer.
If no source supports the answer, say the policy needs to be checked.
Do not cite account tools as policy sources.
    `)
    .context(renderEvidence(evidence), "selected-policy-evidence")
    .tools(createAccountTools({ user, services: input.services }))
    .defaultMaxTurns(4)
    .build();

  const response = await agent
    .prompt(Message.user(input.message))
    .withTrace({
      name: "grounded-policy-answer",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
        evidenceIds: evidence.map((item) => item.id),
      },
    })
    .send();

  await input.evidenceLog.record({
    conversationId: input.conversationId,
    traceId: response.trace?.traceId,
    answer: response.output,
    evidence: evidence.map((item) => ({
      id: item.id,
      score: item.score,
      title: item.metadata?.title,
      source: item.metadata?.source,
      pageNumber: item.metadata?.pageNumber,
    })),
  });

  return { answer: response.output };
}

function renderEvidence(evidence: GroundingEvidence[]) {
  return evidence
    .map((item) =>
      [
        `<source id="${item.id}" title="${item.metadata?.title ?? "Untitled"}">`,
        `Source: ${item.metadata?.source ?? "unknown"}`,
        item.metadata?.pageNumber !== undefined ? `Page: ${item.metadata.pageNumber}` : undefined,
        "",
        String(item.document),
        "</source>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}
```

Use `.dynamicContext(...)` when exact evidence logging is less important than automatic per-turn retrieval. Use manual retrieval when citations, audits, or eval review need the exact selected evidence.

## Citation Rules

| Rule | Why |
| --- | --- |
| label sources with id/title/page | gives the model citation handles |
| tell the model what to do when evidence is missing | avoids unsupported confidence |
| log selected source ids and scores | makes bad answers debuggable |
| keep account tools separate from evidence | prevents live state from becoming policy citation |

## Failure Modes

- Source labels are omitted, so the model cannot cite or distinguish evidence.
- Retrieved docs are treated as live account state.
- Missing evidence produces a confident answer.
- Evidence logs store the final answer but not the selected sources.
- Trace metadata contains full document text instead of stable source ids.

## Next Patterns

- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Observability Loop](/docs/examples/observability-loop)
- [Eval Loop](/docs/examples/eval-loop)
