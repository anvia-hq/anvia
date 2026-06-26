---
title: Agent builder
description: Compose agents with models, instructions, tools, memory, and hooks.
section: advanced
sidebar:
  group: Agent runtime
  order: 11
---

`AgentBuilder` is the place to define behavior that should be true for every run of an agent. Keep it stable: model, instructions, tools, context, memory, event store, observers, hooks, schemas, and default limits.

Do not put request-specific product state into a global builder. User ids, tenant ids, permissions, trace metadata, and request-scoped service handles should be injected by a factory or attached to the prompt request.

## Build A Stable Agent

```ts
import { AgentBuilder } from "@anvia/core";

export function createSupportAgent(scope: SupportAgentScope) {
  return new AgentBuilder("support", scope.model)
    .name("Support")
    .description("Answers customer support questions with account-aware tools.")
    .instructions(
      [
        "Answer from verified support data.",
        "Use tools before making account-specific claims.",
        "Escalate billing, security, or legal uncertainty.",
      ].join("\n"),
    )
    .tools(createSupportTools(scope.services, scope.user))
    .memory(scope.memory, { savePolicy: "turn" })
    .eventStore(scope.eventStore, { include: "all" })
    .observe(scope.observer)
    .defaultMaxTurns(6)
    .build();
}
```

This factory can be called from an HTTP route, worker, test, or Studio setup. The agent id should stay stable because sessions, traces, event records, evals, and internal tooling often use it as an identifier.

## What Belongs On The Builder

Use builder defaults for behavior that is safe across requests:

- `.instructions(...)` for durable operating rules
- `.context(text, id)` for small static documents
- `.tool(...)` or `.tools(...)` for stable tool definitions
- `.mcp(...)` for tools loaded from MCP servers
- `.skills(...)` for skill instructions and skill tools
- `.dynamicContext(...)` for retrieval-selected context
- `.dynamicTools(...)` for retrieval-selected tools
- `.memory(...)` for session-backed conversation history
- `.eventStore(...)` for runtime event persistence
- `.observe(...)` for telemetry adapters
- `.hook(...)` for default runtime control
- `.middleware(...)` for default completion and tool transformations
- `.outputSchema(...)` for provider-level structured output
- `.defaultMaxTurns(...)`, `.temperature(...)`, `.maxTokens(...)`, `.toolChoice(...)`, and `.additionalParams(...)` for model defaults

If a value changes per user or per tenant, prefer a scoped factory. If a value changes per run, prefer methods on the prompt request.

## Request-Scoped Factories

Tools usually need product permissions and service clients. Build those tools in the same scope that knows the current user:

```ts
export function createBillingAgent(scope: BillingScope) {
  const tools = [
    createInvoiceLookupTool(scope.services.billing, scope.user),
    createPlanChangeTool(scope.services.billing, scope.user),
  ];

  return new AgentBuilder("billing", scope.model)
    .instructions("Help with billing questions. Use tools for account data.")
    .tools(tools)
    .memory(scope.memory)
    .build();
}
```

The tool implementation should enforce authorization. Prompt instructions can describe desired behavior, but they are not a security boundary.

## Prompt Request Overrides

After an agent is built, each run can still set per-request behavior:

```ts
const response = await agent
  .session(conversationId, { userId: user.id })
  .prompt(input.message)
  .withTrace({ name: "billing-chat", userId: user.id })
  .withToolConcurrency(2)
  .maxTurns(4)
  .send();
```

Use request overrides for trace metadata, one-off middleware, tool concurrency, approvals, hooks, and tighter turn limits. This keeps the reusable agent small while still letting the runner express product-specific controls.

## Builder Boundaries

Avoid these patterns:

- one global agent that reads the current user from module state
- tools that trust prompt instructions instead of product permissions
- tenant-specific database clients hidden inside shared tool modules
- fallback behavior that assumes every model has the same capabilities
- test agents that require production secrets just to construct

A good builder can be created in a unit test with fake services and a fake model. A good runner can swap the model, memory store, observer, and tools without changing the prompt text.
