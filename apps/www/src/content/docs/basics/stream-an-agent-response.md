---
title: Stream an agent response
description: Stream structured events from an active agent run.
section: basics
sidebar:
  group: Runtime
  order: 8
---

Use `agent.prompt(...).stream()` when the UI should update while the agent is still working.

## Stream an agent run

```ts
for await (const event of agent.prompt("Draft a reply to this customer.").stream()) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    console.log(event.usage);
  }
}
```

## Event types

Agent streams include runtime events, not only model text:

- `turn_start`: a model turn is starting.
- `text_delta`: visible assistant text.
- `tool_call`: the model requested a tool call.
- `tool_result`: your app returned a tool result.
- `final`: the completed run output, usage, messages, and trace.
- `error`: an error from the active run.

## Completion stream vs agent stream

`createCompletionStream` streams one model call. `agent.prompt(...).stream()` streams the whole agent run, including tools and final runtime metadata.

## Next

Pass existing chat history into an agent request.

[Use chat history](/docs/basics/use-chat-history)
