---
title: Streaming Events
description: The pattern for consuming text, tool, and final events.
section: examples
sidebar:
  group: Workflow Patterns
  order: 1
---

Streaming events let the UI show progress while the run is still active. Treat the stream as workflow state, not just text.

## Scenario

A support UI needs to show "looking up order", stream the answer, and persist the final output.

## Example

```ts
type SupportUiState = {
  text: string;
  activity: string[];
  done: boolean;
};

export function reduceSupportEvent(state: SupportUiState, event: AgentStreamEvent) {
  if (event.type === "tool_call") {
    return {
      ...state,
      activity: [...state.activity, `Calling ${event.toolCall.function.name}`],
    };
  }

  if (event.type === "tool_result") {
    return {
      ...state,
      activity: [...state.activity, "Tool returned"],
    };
  }

  if (event.type === "text_delta") {
    return { ...state, text: state.text + event.delta };
  }

  if (event.type === "final") {
    return { ...state, text: event.output, done: true };
  }

  return state;
}
```

Server-side route:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const stream = runSupportTurnStream({ ...body, auth, conversations, services });
  return createEventStream(stream, { format: "jsonl" });
}
```

## Failure Modes

- UI treats stream as text only and loses tool progress.
- Final event is not persisted.
- Tool errors are not represented in UI state.
- Client and server disagree on stream format.

## Next Patterns

- [Long-running Jobs](/docs/examples/long-running-jobs)
- [Observability Loop](/docs/examples/observability-loop)
