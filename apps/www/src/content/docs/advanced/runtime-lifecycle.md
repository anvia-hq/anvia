---
title: Runtime lifecycle
description: Understand what happens inside an agent run.
section: advanced
sidebar:
  group: Agent runtime
  order: 10
  label: Lifecycle
---

An agent run is the boundary where stable agent configuration meets one product request. The route, worker, or job owns authentication, input validation, tenant lookup, and response mapping. The Anvia runtime owns the model-tool loop after your app has created the right agent and prompt request.

Use this page when you need to reason about what core does during `.send()` or `.stream()`.

## Runtime Objects

`AgentBuilder` collects stable runtime behavior: model, instructions, tools, context, memory, event store, observers, hooks, schemas, and default limits. `.build()` returns an `Agent` with those defaults.

An `Agent` can run stateless prompts with `agent.prompt(input)` or conversation prompts through `agent.session(sessionId, options).prompt(input)`. A session requires `.memory(...)` on the agent and gives core the context it needs to load and append messages through your `MemoryStore`.

A prompt request is the per-run object. Use it for request-specific behavior:

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
  .maxTurns(6)
  .send();
```

Keep this chain close to your runner. Do not hide request-specific user, tenant, approval, or trace data inside a global agent.

## Turn Sequence

For a session run, core performs the same sequence for `.send()` and `.stream()`:

1. Create a run id.
2. Load prior messages from the configured `MemoryStore`.
3. Start run observers and call run hooks.
4. Start the first turn with the user prompt.
5. Resolve dynamic context and dynamic tool definitions from the current prompt text.
6. Build the provider-neutral completion request.
7. Apply completion request middleware.
8. Call the model, applying any request-scoped completion retry policy without consuming another turn.
9. Apply completion response middleware and run completion hooks.
10. Store the assistant message according to the memory save policy.
11. Execute requested tools, including approvals, tool hooks, tool middleware, and tool observers.
12. Store tool results according to the memory save policy.
13. Continue until the model returns no tool calls, the run is cancelled, or the max turn limit is reached.

This means dynamic context and dynamic tools are selected per turn. Tool output from one turn can become context for the next turn through the runtime transcript.

## Send Or Stream

Use `.send()` when the caller only needs the final output, usage, and trace metadata. Use `.stream()` when the UI, worker, or operations surface needs runtime events while the run is active.

```ts
const session = agent.session(threadId);
const request = session.prompt(message);

for await (const event of request.stream()) {
  if (event.type === "text_delta") {
    await writer.write(event.delta);
  }
}
```

Streaming emits runtime events, not only text. It can include turn starts, text deltas, reasoning deltas, tool calls, tool results, nested agent tool events, final output, and errors. Filter events before sending them to browser clients if tool arguments or results may contain private data.

`withCompletionRetries(...)` applies to both send and stream execution. Recovered attempts are transparent to the public event stream and are recorded as sanitized `completion.retry` observer events. Streaming retries stop permanently after the first non-error provider event, including provider events that are used internally and not emitted to the caller.

## Memory And Event Storage

Memory and event storage are separate concerns.

Memory stores conversation messages for future prompts. It is keyed by `MemoryContext`, which includes the session id and optional user or metadata. Use it for product conversation continuity.

The event store records runtime stream events by run id. Use it for replay, debugging, internal audit, and operations tooling. Do not rely on the event store as the source of conversation history.

```ts
const agent = new AgentBuilder("support", model)
  .memory(memoryStore, { savePolicy: "turn" })
  .eventStore(eventStore, { include: "all" })
  .build();
```

The save policy controls when messages are appended to memory:

- `"message"` appends each new prompt, assistant message, and tool message as it is created.
- `"turn"` batches messages at the end of each completed turn.
- `"run"` appends the run messages when the run completes.

Choose the policy based on your durability needs. For long tool chains, `"message"` gives the most incremental persistence. For cleaner storage writes, `"turn"` is usually easier to reason about.

## Failure Boundaries

Core can throw runtime errors such as `MaxTurnsError`, `PromptCancelledError`, and `ToolApprovalRequiredError`. Provider packages can also throw provider-specific SDK errors. Map those errors in the runner that owns the product workflow.

When a run fails and the memory store implements `recordError`, core calls it with the memory context, run id, error, and messages produced so far. Use that for audit or recovery records. Do not show raw provider or tool errors directly to users.

## Design Rule

Build agents with stable behavior. Build sessions with durable conversation identity. Build prompt requests with per-run controls. Keep product authorization, retries, response shape, and persistence policy outside prompt text.
