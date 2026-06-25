---
title: Send a prompt
description: Run an agent request and handle the final response.
section: basics
sidebar:
  group: Runtime
  order: 7
---

Use `agent.prompt(...).send()` when you want the final result from an agent run.

## Send a request

```ts
const response = await agent.prompt("Summarize this support ticket.").send();

console.log(response.output);
```

## What you get back

`send()` returns a prompt response:

- `output`: final visible assistant text.
- `usage`: accumulated token usage.
- `messages`: messages created during the run.
- `trace`: trace metadata when tracing is enabled.

## Configure one request

Prompt requests can override runtime behavior before execution:

```ts
const response = await agent
  .prompt("Summarize this ticket in one sentence.")
  .maxTurns(2)
  .send();
```

Use request-level configuration when one call needs tighter limits than the agent default.

## Next

Stream an agent response.

[Stream an agent response](/docs/basics/stream-an-agent-response)
