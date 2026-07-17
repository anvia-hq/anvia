---
title: Sessions, traces, and persistence
description: Inspect Studio sessions, memory, runtime status, traces, and persisted local state.
section: studio
sidebar:
  group: Operations
  order: 1
  label: Sessions and traces
---

Studio records local runtime evidence so development and internal operations can answer what happened in a run. The key surfaces are sessions, traces, memory, status, pipeline logs, and pipeline run history.

Run the inspection surfaces example:

```sh
pnpm cookbook:studio:09
```

Then open the runtime status page:

```txt
http://localhost:4021/ui/status
```

## Sessions

Sessions group transcript entries for Studio runs. After you create a Playground session, the Sessions page can show the user messages, assistant messages, tool calls, approval state, question state, and run status stored for that conversation.

Studio session storage is a development/runtime concern. Product conversation memory should still be designed as part of your application boundary.

## Traces

Traces capture runtime observations such as agent runs, model generations, tools, timings, status, and usage when available. Use the tracing page when you need to debug behavior across turns or compare local runs.

## Memory and Status

The Memory page discovers read-only memory sources from the agents registered with Studio. The
Prisma, Drizzle, Postgres, and SQLite memory adapters expose existing database conversations
automatically, including conversations created before Studio started. No separate Studio memory
configuration or schema migration is required.

Agent memory is the primary source. When multiple agents share the same store, Studio shows one
source associated with those agents rather than duplicating its conversations. An agent with a
custom `MemoryStore` that does not implement the optional core `MemoryInspector` capability is
shown as unavailable. Studio does not silently replace it with another store.

For newly generated assistant messages, conversation detail shows the persisted provider, model,
and per-generation token usage alongside the response. Legacy messages remain readable and show
that usage is unavailable. The raw message and record JSON panels remain available for exact
inspection.

For agents that have no configured memory, the Memory page falls back to the Studio session store.
This keeps the two responsibilities separate:

- Memory shows product conversation messages persisted by the agent.
- Sessions shows Studio operational state such as reasoning, tools, approvals, questions,
  cancellation, durations, and logs.

The source-scoped API begins at `GET /memory/sources`. Conversation listing and detail routes live
under `/memory/sources/:sourceRef`. The existing `/memory/users` and `/memory/conversations` routes
continue to expose the Studio session store for compatibility.

The Status page reports runtime counts and capability flags, while `/status` returns the raw status
API response.

`09-inspection-surfaces.ts` prints these URLs:

```txt
http://localhost:4021/ui/memory
http://localhost:4021/ui/status
http://localhost:4021/status
```

## Persistent Store

Run the SQLite store example:

```sh
pnpm cookbook:studio:10
```

It writes local Studio state to:

```txt
.anvia-studio/cookbook-studio.sqlite
```

The example passes one SQLite store through:

```ts
new Studio([agent, escalationPipeline], {
  stores: {
    sessions: store,
    traces: store,
    pipelineLogs: store,
    pipelineRuns: store,
  },
});
```

Use this when you want sessions, traces, pipeline logs, and pipeline run history to survive process restarts during local development.

## Related Cookbook Files

- `examples/cookbook/09_studio/09-inspection-surfaces.ts`
- `examples/cookbook/09_studio/10-persistent-store.ts`
