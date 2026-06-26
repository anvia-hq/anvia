---
title: Production agent architecture
description: Design production-ready agent systems and runtime boundaries.
section: advanced
sidebar:
  group: Production architecture
  order: 3
  label: Architecture
---

Production agents need a harness: application-owned code that prepares one run, controls access to product behavior, records what happened, and returns a product response.

The harness is ordinary TypeScript. Anvia runs the model-tool loop. Your app owns correctness, permissions, data access, transactions, retries, deployment, and user-facing response shape.

## Ownership

Keep the ownership split simple. Routes and workers handle transport. Runners handle one product workflow. Agent factories hold stable runtime behavior. Tools call product services and enforce permissions. Storage records history, events, approvals, and audit data.

If a decision affects product security or data ownership, keep it in application code or a tool. If it affects how the model is prompted, constrained, streamed, or observed, configure it on the agent or prompt request.

## Recommended Modules

```txt
src/
  ai/
    model.ts
    support-agent.ts
    support-tools.ts
    support-runner.ts
  services/
    orders.ts
    tickets.ts
  storage/
    memory.ts
    agent-events.ts
  routes/
    support.ts
```

The direction of dependencies matters more than the exact folders. Routes call runners. Runners create scoped tools and agents. Tools call services. Services own product data and transactions. Storage modules persist messages and audit records.

## Stable Agent Module

Use a shared built agent when tools are context-free, read-only, or already enforce their own scope:

```ts
import { AgentBuilder } from "@anvia/core";
import { model } from "./model";
import { publicDocsTool } from "./support-tools";

export const supportAgent = new AgentBuilder("support", model)
  .name("Support Agent")
  .instructions("Answer support questions clearly. Ask before guessing.")
  .tool(publicDocsTool)
  .defaultMaxTurns(3)
  .build();
```

This shape works well for Studio, tests, internal tools, and workflows where the same tool definitions are safe for every caller.

## Scoped Agent Factory

Use a factory when tools need the current user, tenant, feature flags, service handles, or transaction:

```ts
export function createSupportAgent(scope: SupportScope) {
  return new AgentBuilder("support", scope.model)
    .instructions("Answer support questions clearly. Use tools for account data.")
    .tools(
      createSupportTools({
        userId: scope.user.id,
        tenantId: scope.user.tenantId,
        orders: scope.services.orders,
      }),
    )
    .context(`Current customer plan: ${scope.user.plan}`, "customer-plan")
    .memory(scope.memory, { savePolicy: "message" })
    .defaultMaxTurns(3)
    .build();
}
```

Do not hide request state in globals. Pass scope explicitly so tests can replace services, memory stores, and product code can enforce tenant boundaries.

## Runner Boundary

The runner is the place where product behavior becomes explicit:

```ts
export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportAgent({
    user,
    model: input.model,
    memory: input.memory,
    services: input.services,
  });

  const response = await agent
    .session(input.conversationId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .prompt(input.message)
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: { tenantId: user.tenantId, conversationId: input.conversationId },
    })
    .send();

  return { output: response.output, usage: response.usage };
}
```

## Request Lifecycle

A production request usually follows the same sequence even when the transport changes. Validate the input first. Authenticate and load the actor. Resolve tenant, feature flags, service handles, and the memory store. Build the scoped tools and agent. Create a session from the conversation id and safe metadata. Run the prompt with trace metadata. Let the configured memory store load and append runtime messages. Persist any app-owned audit records. Map the response into the product shape.

Keeping this sequence in a runner makes HTTP routes, jobs, tests, and Studio setup easier to share. A route can return JSON. A worker can store a result. A test can inject fake services. The agent runtime stays the same.

For conversations, configure `.memory(...)` on the agent and use `agent.session(conversationId).prompt(...)` so core controls the message lifecycle consistently with the selected save policy.

## Tool Scope

Tools are where the model reaches into your product. Treat every tool as a boundary crossing. A tool should validate input, enforce caller permissions, call a service, and return only the result the model needs.

For read tools, tenant filtering is usually the critical check. For write tools, use idempotency keys, transactions, or explicit approval flows. Do not rely on prompt instructions to prevent writes the product would otherwise reject.

## Common Mistakes

Avoid putting permissions only in instructions. Avoid tools that read the current user from module state. Avoid one giant agent that changes behavior based on loosely typed metadata. Avoid bypassing `MemoryStore` for durable conversations. Avoid building a separate architecture for Studio instead of registering the same safe agents and factories used by product code.

Before shipping, confirm that input is validated, tools enforce permissions, context is scoped, memory is durable, side effects are idempotent or transactional, traces use safe metadata, and known errors are mapped at the runner boundary.
