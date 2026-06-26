---
title: Agent Structure
description: The pattern for separating stable agent configuration from request state.
section: examples
sidebar:
  group: Foundation Patterns
  order: 3
---

Agent structure separates stable runtime configuration from request-local state. Stable values can be created once. User, tenant, permissions, feature flags, and service transactions should be scoped per request.

## Scenario

The support agent always has the same identity and behavior, but every request has a different user and tenant. The model instructions are stable; the order tools must be scoped.

## Stable Configuration

```ts
// ai/support-agent.ts
import { AgentBuilder, type CompletionModel } from "@anvia/core";
import { createSupportTools, type SupportToolScope } from "./support-tools";

const supportInstructions = `
Answer support questions clearly.
Use tools for account-specific facts.
Ask for missing identifiers before guessing.
`;

export function configureSupportAgent(model: CompletionModel) {
  return new AgentBuilder("support", model)
    .name("Support Agent")
    .description("Answers customer support questions.")
    .instructions(supportInstructions)
    .defaultMaxTurns(4);
}
```

## Scoped Factory

```ts
export function createSupportAgent(scope: SupportToolScope) {
  return configureSupportAgent(scope.model)
    .tools(createSupportTools(scope))
    .context(`Current plan: ${scope.user.plan}`, "customer-plan")
    .build();
}
```

```ts
// ai/support-runner.ts
const agent = createSupportAgent({
  model,
  user,
  tenantId: user.tenantId,
  services: input.services,
});
```

## Placement Guide

| Put it in | Example |
| --- | --- |
| stable config | agent id, name, instructions, default turn limit |
| scoped factory | tenant-aware tools, user context, feature-flagged behavior |
| runner | auth, history loading, trace metadata, persistence |
| tool factory | service handles, permission scope, idempotency keys |
| prompt request | current message, one-off max turns, stream/final choice |

## Why This Boundary Matters

Stable agent modules are easy to import in Studio and tests. Scoped factories prevent request state from leaking into other users' runs.

## Failure Modes

- A module-level variable stores the current user.
- Tools parse user ids from prompt text.
- Studio cannot import the agent without route-only dependencies.
- Tests need real services because the factory does not accept fakes.

## Next Patterns

- [Request Runner](/docs/examples/request-runner)
- [Context and Memory](/docs/examples/context-and-memory)
- [Tool Boundaries](/docs/examples/tool-boundaries)
