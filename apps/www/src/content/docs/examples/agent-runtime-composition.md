---
title: Agent Runtime Composition
description: How to assemble an Anvia agent from model, instructions, tools, context, memory, observers, and output contracts.
section: examples
sidebar:
  group: Foundation Patterns
  order: 2
---

Agent runtime composition is the point where product code decides which Anvia capabilities belong in one run. Keep stable behavior in an agent factory, and pass request-local state through a scoped factory or runner.

## Scenario

A support agent always has the same identity and behavior. Each request has a different user, tenant, conversation, permissions, feature flags, and service handles. The runtime should make those boundaries visible.

## Composition Surface

| Runtime part | Use it for |
| --- | --- |
| model | provider and model selection |
| instructions | stable behavior and policy |
| tools | request-scoped product capabilities |
| dynamic context | retrieved evidence selected at prompt time |
| memory/session | durable conversation messages |
| event store | replayable runtime events |
| observers | traces, telemetry, and external monitoring |
| output schema | final structured response when the provider supports it |
| approvals | human or policy gates for sensitive tools |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";
import { z } from "zod";

const supportAnswerSchema = z.object({
  answer: z.string(),
  citedSources: z.array(z.string()),
  needsHuman: z.boolean(),
});

export function createSupportRuntime(scope: SupportRuntimeScope) {
  const builder = new AgentBuilder("support", scope.model)
    .name("Support Agent")
    .description("Answers account and policy questions for signed-in customers.")
    .instructions(`
Use account tools for customer-specific state.
Use retrieved support documents for policy.
If evidence is missing, say what needs to be checked.
Never treat retrieved policy as permission to read or change account data.
    `)
    .dynamicContext(scope.policyIndex, {
      topK: 4,
      threshold: 0.72,
      filter: vectorFilter.and(
        vectorFilter.eq("tenantId", scope.user.tenantId),
        vectorFilter.eq("visibility", "public"),
      ),
      format: (result) => ({
        id: result.id,
        text: [
          `<policy-source id="${result.id}" title="${result.metadata?.title ?? "Untitled"}">`,
          String(result.document),
          "</policy-source>",
        ].join("\n"),
      }),
    })
    .tools(createSupportTools(scope))
    .memory(scope.memoryStore, { savePolicy: "turn" })
    .eventStore(scope.eventStore, { include: "all" })
    .observe(scope.observer)
    .defaultMaxTurns(4);

  if (scope.model.capabilities.outputSchema) {
    builder.outputSchema(supportAnswerSchema);
  }

  return builder.build();
}

export async function answerSupportMessage(input: SupportMessageInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportRuntime({ ...input, user });

  const session = agent.session(input.conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  });

  return session.prompt(input.message).approvals(input.approvals).send();
}
```

Not every agent needs every feature. The value of this shape is that each feature has a clear owner and a clear reason to be present.

If you need replayable event-store records, run the request through `.stream()` and drain the stream. The event store records runtime stream events by run id.

## Stable Versus Request-Local

| Stable | Request-local |
| --- | --- |
| agent id and name | user and tenant |
| base instructions | authz scope |
| default model policy | service transaction handles |
| generic output schema | idempotency key |
| observer type | trace metadata |
| static behavior | dynamic context filters |

## Production Checks

- Request-local permissions are not hidden in prompt text.
- Dynamic context filters include tenant, product, visibility, or other access constraints.
- Memory is not used as the source of truth for live product state.
- Structured output is only enabled for model paths that support output schemas.
- Observers and event stores have retention and redaction policies.

## Next Patterns

- [Agent App Flow](/docs/examples/agent-app-flow)
- [Context Assembly](/docs/examples/context-assembly)
- [Structured Results](/docs/examples/structured-results)
