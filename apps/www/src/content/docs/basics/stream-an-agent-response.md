---
title: Stream an agent response
description: Stream structured events from an active agent run.
section: basics
sidebar:
  group: Runtime
  order: 8
---

Use `agent.prompt(...).stream()` when the UI should update while the agent is still working.

## When to use this

Use agent streaming when you need progressive text, tool-call visibility, final usage, or error events from one agent run.

## Prerequisites

Send a prompt with `send()` first so you know the agent works without streaming.

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
- `reasoning_delta`: provider reasoning text when the model emits it.
- `tool_call`: the model requested a tool call.
- `tool_result`: your app returned a tool result.
- `turn_end`: a model turn completed with a provider response.
- `agent_tool_event`: a nested agent emitted an event while running as a tool.
- `final`: the run id, completed output, usage, messages, and trace.
- `error`: an error from the active run.

## Completion stream vs agent stream

`createCompletionStream` streams one model call. `agent.prompt(...).stream()` streams the whole agent run, including tools and final runtime metadata.

## Check yourself

Run the loop and confirm you receive `text_delta` events before the final event.

## Next

Add tools so the agent can call product actions.

[Add tools](/docs/basics/add-tools)
