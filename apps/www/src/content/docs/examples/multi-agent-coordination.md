---
title: Multi-agent Coordination
description: The pattern for coordinating specialist agents inside one parent workflow.
section: examples
sidebar:
  group: Workflow Patterns
  order: 4
---

Multi-agent coordination should keep one parent workflow in charge. Specialists can do focused work, but the coordinator owns the final response and trace.

## Scenario

A research assistant asks policy, pricing, and technical specialists for input, then writes one answer.

## Example

```ts
const askPolicy = policyAgent.asTool({
  name: "ask_policy_specialist",
  description: "Ask the policy specialist for policy constraints.",
});

const askPricing = pricingAgent.asTool({
  name: "ask_pricing_specialist",
  description: "Ask the pricing specialist for plan and billing facts.",
});

const coordinator = new AgentBuilder("research-coordinator", model)
  .instructions(`
Coordinate specialist tools.
Summarize disagreements.
Return one final answer with assumptions.
  `)
  .tools([askPolicy, askPricing])
  .defaultMaxTurns(6)
  .build();

const response = await coordinator
  .prompt(input.question)
  .withTrace({
    name: "research-coordination",
    userId: input.user.id,
  })
  .send();
```

## Failure Modes

- Specialists write final user-facing answers independently.
- Parent and child events are not grouped in the UI.
- Specialist tools can perform side effects unexpectedly.
- Coordinator has no turn limit.

## Next Patterns

- [Streaming Events](/docs/examples/streaming-events)
- [Research Agent](/docs/examples/research-agent)
