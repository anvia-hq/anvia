---
title: Multi-agent systems
description: Coordinate specialist agents and nested agent execution.
section: advanced
sidebar:
  group: Agent runtime
  order: 18
  label: Multi-agent
---

Multi-agent systems let one agent delegate focused work to another agent. In `@anvia/core`, the simplest pattern is to expose a specialist agent as a tool with `agent.asTool(...)`, then register that tool on a coordinator agent.

Use this when a task has clear specialist boundaries: research, policy review, support triage, code explanation, extraction, or summarization. Do not split agents just to make the architecture look more advanced.

## Agent As Tool

Build the specialist first:

```ts
const policyAgent = new AgentBuilder("policy-review", model)
  .instructions("Review answers for policy risk. Return concise findings.")
  .defaultMaxTurns(2)
  .build();
```

Expose it as a tool on the coordinator:

```ts
const supportAgent = new AgentBuilder("support", model)
  .instructions("Answer support questions. Ask policy_review before high-risk answers.")
  .tool(
    policyAgent.asTool({
      name: "policy_review",
      description: "Review a draft support answer for policy risk.",
      maxTurns: 2,
    }),
  )
  .tools(supportTools)
  .build();
```

When the coordinator calls `policy_review`, core runs the child agent with the tool input prompt and returns the child output as the tool result.

## Streaming Child Events

Set `stream: true` when you want child agent stream events to appear in the parent stream:

```ts
const policyTool = policyAgent.asTool({
  name: "policy_review",
  description: "Review a draft answer for policy risk.",
  maxTurns: 2,
  stream: true,
});
```

Then consume the parent request stream:

```ts
const session = supportAgent.session(threadId, { userId: user.id });
const request = session.prompt(message);

for await (const event of request.stream()) {
  if (event.type === "agent_tool_event") {
    await operationsLog.write({
      childAgentId: event.agentId,
      toolName: event.toolName,
      childEvent: event.event.type,
    });
  }
}
```

`agent_tool_event` is operational detail. For user-facing clients, collapse child activity into a simple status unless users are expected to inspect the sub-agent workflow.

## Memory Boundaries

`agent.asTool(...)` runs the child agent as a stateless prompt. It does not automatically use a child session or child memory context.

If a child agent needs durable memory, create a normal tool that calls the child through a session:

```ts
import { createTool } from "@anvia/core";
import { z } from "zod";

const askPolicyMemory = createTool({
  name: "ask_policy_memory",
  description: "Ask the policy agent with its own session memory.",
  input: z.object({ prompt: z.string() }),
  output: z.string(),
  async execute({ prompt }) {
    const session = policyAgent.session(`policy:${threadId}`, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    });
    const request = session.prompt(prompt).maxTurns(2);
    const response = await request.send();

    return response.output;
  },
});
```

Use this pattern only when child memory is truly needed. Most child agents should be stateless and receive the relevant task in the tool prompt.

## Coordinator Responsibilities

The coordinator agent decides when to delegate. Keep its instructions explicit:

```ts
const coordinator = new AgentBuilder("incident-coordinator", model)
  .instructions(
    [
      "Classify the incident.",
      "Use log_analysis for logs and policy_review for customer-facing statements.",
      "Synthesize the final answer yourself after tools return.",
    ].join("\n"),
  )
  .tool(logAgent.asTool({ name: "log_analysis", maxTurns: 3 }))
  .tool(policyAgent.asTool({ name: "policy_review", maxTurns: 2 }))
  .build();
```

The coordinator should own final user-facing wording. Child agents should return focused findings, summaries, or recommendations.

## Failure And Limits

Give child agents smaller turn limits than the coordinator. A child that can call tools or other agents can otherwise consume most of the run budget.

```ts
const researchTool = researchAgent.asTool({
  name: "research",
  description: "Research a focused question and return sources.",
  maxTurns: 3,
});
```

Map failures at the parent runner boundary. If a child agent fails, the parent sees that failure as a tool failure unless hooks or tool error handling convert it into a result.

## When Not To Use Multiple Agents

Keep one agent when the task is a single workflow with the same tools and the same policy. Multiple agents add useful boundaries, but they also add more instructions, more model calls, more traces, and more failure modes.

Split agents when the child has a distinct role, a distinct tool set, a distinct model, a distinct output expectation, or a reason to be tested independently.

## Production Checklist

Before shipping a multi-agent flow, verify:

- each child agent has a stable id and clear instructions
- child tools have small `maxTurns`
- private child events are filtered before reaching users
- the parent owns final response shape
- side-effect tools still enforce product permissions
- traces and event store records make parent and child runs understandable
