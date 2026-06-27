---
title: Agent App Flow
description: A complete request flow for an Anvia agent inside product code.
section: examples
sidebar:
  group: Foundation Patterns
  order: 1
---

An agent app flow is the application-owned shell around one Anvia run. It starts at a route, action, queue job, or worker; resolves product state; composes the agent with scoped tools and context; runs the model/tool loop; persists what happened; and returns a product response.

## Scenario

A signed-in customer asks, "Where is order A-100 and can I change the address?" The app must authenticate the user, load conversation history, expose only tools scoped to that user and tenant, retrieve support policy, run the agent, persist messages and events, and return only the answer the UI needs.

## Flow

| Step | Owner | Example responsibility |
| --- | --- | --- |
| Transport | app | Parse HTTP, server action, queue, or UI input. |
| Runner | app | Validate input, resolve auth, load history, create request scope. |
| Agent runtime | Anvia + app | Run instructions, model, tools, context, memory, observers, and approvals. |
| Tools | app | Enforce permissions and call product services. |
| Persistence | app | Save messages, events, audit records, and product state. |
| Response | app | Return a UI or API shape, not raw provider internals. |

## Example

```ts
import { AgentBuilder, Message } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

export async function POST(request: Request) {
  const body = await request.json();

  const result = await runSupportTurn({
    conversationId: body.conversationId,
    message: body.message,
    auth,
    conversations,
    model,
    policyIndex,
    services: { orders, tickets },
    traces,
  });

  return Response.json(result);
}

export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages({
    conversationId: input.conversationId,
    userId: user.id,
    tenantId: user.tenantId,
  });

  const agent = createSupportAgent({
    model: input.model,
    user,
    policyIndex: input.policyIndex,
    services: input.services,
  });

  const response = await agent
    .prompt([...history, Message.user(input.message)])
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .send();

  await input.conversations.append({
    conversationId: input.conversationId,
    userId: user.id,
    messages: response.messages,
  });

  if (response.trace?.traceId !== undefined) {
    await input.traces.link({
      conversationId: input.conversationId,
      traceId: response.trace.traceId,
    });
  }

  return {
    answer: response.output,
    traceId: response.trace?.traceId,
  };
}

function createSupportAgent(scope: SupportAgentScope) {
  return new AgentBuilder("support", scope.model)
    .instructions(`
Answer with the user's current account state and retrieved policy evidence.
Use tools for customer-specific data.
Do not claim an action was completed unless a tool result says it was completed.
    `)
    .dynamicContext(scope.policyIndex, {
      topK: 4,
      threshold: 0.72,
      filter: vectorFilter.and(
        vectorFilter.eq("productArea", "checkout"),
        vectorFilter.eq("visibility", "public"),
      ),
      format: (result) => ({
        id: result.id,
        text: [
          `Title: ${result.metadata?.title ?? "Untitled"}`,
          `Updated: ${result.metadata?.updatedAt ?? "unknown"}`,
          String(result.document),
        ].join("\n"),
      }),
    })
    .tools(createSupportTools(scope))
    .defaultMaxTurns(4)
    .build();
}
```

The exact framework can change. The important boundary is stable: transport calls the runner, the runner creates request scope, tools enforce product rules, and the application persists the useful result.

## Swap Points

| Part | What can change |
| --- | --- |
| transport | HTTP route, server action, queue worker, CLI command, scheduled job |
| model | OpenAI, Anthropic, Gemini, Mistral, or compatible provider |
| retrieval | dynamic context, explicit retrieval tool, or both |
| storage | application database, memory store, event store, trace backend |
| response | streamed UI events, JSON API output, queued job result |

## Production Checks

- The model never receives a user id, tenant id, or permission scope from model-controlled arguments.
- Tools are created from authenticated request scope.
- Conversation persistence is separate from audit and event logs.
- Trace metadata is enough to debug the run later.
- Expected denials return safe product messages instead of leaking service errors.

## Next Patterns

- [Agent Runtime Composition](/docs/examples/agent-runtime-composition)
- [Permissioned Tools](/docs/examples/permissioned-tools)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
