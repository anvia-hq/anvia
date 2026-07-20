---
title: Streaming Events
description: A pattern for turning agent streams into UI state, persisted events, and final results.
section: examples
sidebar:
  group: Workflow Patterns
  order: 1
---

Streaming events let the UI show progress while the run is still active. Treat the stream as workflow state, not just text. Tool calls, tool results, errors, and the final event should all have a product meaning.

## Scenario

A support UI needs to show "looking up order", stream the answer, persist the final output, and link the run to a trace for debugging.

## Flow

| Step | Owner |
| --- | --- |
| run agent stream | server runner |
| reduce events for UI | app reducer |
| persist final event | memory store and product run store |
| store trace/run ids | product run record |
| filter browser events | transport layer |

## Server Runner

```ts
import type { AgentStreamEvent, Usage } from "@anvia/core";

type SupportUiEvent =
  | { type: "activity"; label: string }
  | { type: "text"; delta: string }
  | { type: "final"; output: string; runId: string }
  | { type: "error"; message: string; usage: Usage };

export async function* runSupportTurnStream(input: SupportStreamInput) {
  const user = await input.auth.requireUser();
  const agent = createSupportAgent({ ...input, user });

  const stream = agent
    .session(input.conversationId, {
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .prompt(input.message)
    .withTrace({
      name: "support-chat",
      userId: user.id,
      metadata: {
        tenantId: user.tenantId,
        conversationId: input.conversationId,
      },
    })
    .stream();

  for await (const event of stream) {
    await input.runEvents.append({
      conversationId: input.conversationId,
      event,
    });

    const uiEvent = toSupportUiEvent(event);
    if (uiEvent !== undefined) {
      yield uiEvent;
    }

    if (event.type === "final") {
      await input.runs.record({
        conversationId: input.conversationId,
        runId: event.runId,
        traceId: event.trace?.traceId,
        output: event.output,
        usage: event.usage,
      });
    }
  }
}
```

## UI Event Mapping

```ts
function toSupportUiEvent(event: AgentStreamEvent): SupportUiEvent | undefined {
  if (event.type === "tool_call") {
    return {
      type: "activity",
      label: `Calling ${event.toolCall.function.name}`,
    };
  }

  if (event.type === "tool_result") {
    return {
      type: "activity",
      label: `${event.toolName} returned`,
    };
  }

  if (event.type === "text_delta") {
    return { type: "text", delta: event.delta };
  }

  if (event.type === "final") {
    return {
      type: "final",
      output: event.output,
      runId: event.runId,
    };
  }

  if (event.type === "error") {
    return { type: "error", message: "The run failed.", usage: event.usage };
  }
}
```

Server-side transport can expose the filtered UI stream:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const stream = runSupportTurnStream({
    ...body,
    auth,
    memoryStore,
    services,
    runEvents,
  });

  return createEventStream(stream, { format: "jsonl" });
}
```

The session memory store records conversation messages as the stream is consumed. The final event is still useful for app-owned run records, reload state, usage tracking, and trace lookup.

## Browser State

```ts
export function reduceSupportEvent(state: SupportUiState, event: SupportUiEvent) {
  if (event.type === "activity") {
    return { ...state, activity: [...state.activity, event.label] };
  }
  if (event.type === "text") {
    return { ...state, text: state.text + event.delta };
  }
  if (event.type === "final") {
    return { ...state, text: event.output, runId: event.runId, done: true };
  }
  if (event.type === "error") {
    return { ...state, error: event.message, done: true };
  }
  return state;
}
```

## Failure Modes

- UI treats stream as text only and loses tool progress.
- Final event is not persisted, so reloads lose the answer.
- Raw tool arguments, tool results, or retrieved documents are streamed to the browser.
- Client and server disagree on stream format.
- Errors are stored only in logs and not mapped to UI state.

## Next Patterns

- [Long-running Jobs](/docs/examples/long-running-jobs)
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence)
- [Observability Loop](/docs/examples/observability-loop)
