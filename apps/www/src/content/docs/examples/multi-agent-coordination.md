---
title: Multi-agent Coordination
description: A pattern for coordinating specialist agents inside one parent workflow.
section: examples
sidebar:
  group: Workflow Patterns
  order: 4
---

Multi-agent coordination should keep one parent workflow in charge. Specialists can do focused work, but the coordinator owns the final response, trace, turn limit, and product persistence.

## Scenario

A research assistant asks policy, pricing, and technical specialists for input, then writes one answer. Specialist agents must be read-only and should not send user-facing answers independently.

## Flow

| Agent | Responsibility |
| --- | --- |
| coordinator | frames the task, calls specialists, resolves conflicts, writes final answer |
| policy specialist | answers policy constraints from approved docs |
| pricing specialist | answers pricing and billing facts |
| technical specialist | checks technical docs or runbooks |

## Example

```ts
const askPolicy = policyAgent.asTool({
  name: "ask_policy_specialist",
  description: "Ask the policy specialist for policy constraints.",
  stream: true,
});

const askPricing = pricingAgent.asTool({
  name: "ask_pricing_specialist",
  description: "Ask the pricing specialist for plan and billing facts.",
  stream: true,
});

const askTechnical = technicalAgent.asTool({
  name: "ask_technical_specialist",
  description: "Ask the technical specialist for implementation constraints.",
  stream: true,
});

const coordinator = new AgentBuilder("research-coordinator", model)
  .instructions(`
Coordinate specialist tools.
Ask specialists for evidence, not final user-facing answers.
Summarize disagreements and uncertainty.
Return one final answer with cited assumptions.
  `)
  .tools([askPolicy, askPricing, askTechnical])
  .defaultMaxTurns(6)
  .build();

export async function runCoordinatedResearch(input: CoordinatedResearchInput) {
  const response = await coordinator
    .prompt(input.question)
    .withTrace({
      name: "research-coordination",
      userId: input.user.id,
      metadata: {
        tenantId: input.user.tenantId,
        reportId: input.reportId,
      },
    })
    .send();

  await input.reports.saveDraft({
    reportId: input.reportId,
    output: response.output,
    traceId: response.trace?.traceId,
  });

  return { output: response.output };
}
```

## Specialist Rules

| Rule | Why |
| --- | --- |
| specialists are read-only | avoids hidden side effects |
| coordinator owns final answer | gives one traceable product result |
| tool descriptions define specialist scope | prevents duplicate or conflicting work |
| parent turn limit is explicit | avoids runaway coordination |
| child events are grouped | makes nested work visible in traces/UI |

## Failure Modes

- Specialists write final user-facing answers independently.
- Parent and child events are not grouped in the UI.
- Specialist tools can perform side effects unexpectedly.
- Coordinator has no turn limit.
- Disagreements are hidden instead of summarized.

## Next Patterns

- [Streaming Events](/docs/examples/streaming-events)
- [Research Agent](/docs/examples/research-agent)
- [Observability Loop](/docs/examples/observability-loop)
