---
title: Configuration
description: Configure model defaults, runtime behavior, and production controls.
section: advanced
sidebar:
  group: Production architecture
  order: 8
---

Production configuration should make stable behavior explicit while keeping request-local facts at the runner boundary.

Configure defaults on the agent. Configure current user, tenant, input, trace metadata, timeout policy, and product response mapping in the runner.

## Configuration Layers

A useful production stack usually has four layers:

- environment config for secrets, provider endpoints, and deployment-specific values
- model factories that turn provider clients into reusable model objects
- agent defaults for stable identity, instructions, tools, observers, and limits
- session context and prompt request overrides for current input, trace metadata, and one-off limits

Keep these layers separate. A model factory should not read the current user. An agent module should not own product-route response mapping. A runner should not need to know provider SDK details.

## Agent Defaults

```ts
const agent = new AgentBuilder("support", model)
  .name("Support Agent")
  .description("Answers support questions and uses support tools.")
  .instructions("Answer clearly. Use tools for account data.")
  .defaultMaxTurns(3)
  .maxTokens(800)
  .temperature(0.2)
  .memory(memoryStore, { savePolicy: "message" })
  .build();
```

Use the agent id as a stable runtime identity for traces, Studio, sessions, and workflows. Put durable behavior in instructions. Add only context that is safe for every run. Register stable tools here, and use scoped factories for tools that need the current request.

Set default max turns, max tokens, temperature, and output schema before launch so cost and behavior are predictable.

## Request-Scoped Configuration

Set current facts when creating the prompt request:

```ts
const response = await agent
  .session(conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  })
  .prompt(input.message)
  .withTrace({
    name: "support-chat",
    userId: user.id,
    metadata: { tenantId: user.tenantId, conversationId },
  })
  .maxTurns(2)
  .send();
```

Request-scoped values include current message, session id, user id, tenant id, feature flags, trace metadata, one-off limits, approval handlers, and product-specific error mapping. The session options become the `MemoryContext` passed to your configured `MemoryStore`.

## Environment Configuration

Store provider API keys and vector database credentials as deployment secrets. Put model ids, provider base URLs, and tracing endpoints in typed app config. Validate that config before constructing provider clients so failures are visible at startup.

```ts
const env = configSchema.parse(process.env);
const openai = new OpenAIClient({ apiKey: env.OPENAI_API_KEY });
export const supportModel = openai.completionModel(env.SUPPORT_MODEL);
```

Avoid reading `process.env` from every tool or runner. Centralized config validation makes missing secrets and invalid model ids fail early.

## Model Factories

Model factories are a clean place to translate config into runtime capabilities:

```ts
export function createModels(env: AppEnv) {
  const openai = new OpenAIClient({ apiKey: env.OPENAI_API_KEY });

  return {
    support: openai.completionModel(env.SUPPORT_MODEL),
    extraction: openai.completionModel(env.EXTRACTION_MODEL),
  };
}
```

Factories keep provider SDK setup away from routes and tools. They also make tests easier because a runner can receive fake models without touching environment variables.

## Approval And Safety Config

Some controls are not model settings. Tool approval rules, reviewer permissions, idempotency policies, and audit destinations belong in product code. Configure the agent to request approval when needed, but keep the decision and persistence flow in your application.

This keeps local development flexible while preserving production guarantees. Studio can help approve local runs, but production approvals usually need product identity, durable records, and notification flows.

## Memory And Events

Use memory when the agent should load and append conversation messages by session id. Use an event store when you need replay, audit, or low-level run diagnostics.

Memory stores conversation messages for future prompts. Event stores capture runtime events, tool calls, generation events, and audit detail. Trace observers send run, generation, and tool events to external telemetry.

Choose durable stores for production. In-memory stores are useful for examples and local tests only.

For product chat, use `agent.session(id).prompt(message)`. Sessions keep durable memory behavior tied to the store and save policy configured on the agent.

## Configuration Checklist

- Use stable agent ids.
- Keep secrets in server-only config.
- Validate provider and store config at startup.
- Put permissions in tools and services.
- Keep request facts out of global variables.
- Set max turns and token limits before launch.
- Attach safe trace metadata.
- Test every configured provider model id.
