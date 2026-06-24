---
"@anvia/langfuse": minor
---

Add `LangfuseTraceHandle` and `getCurrentTrace()` to the langfuse
tracing instance so user code can record event observations and
attach attributes to the active trace without threading the run
observer through every function call.

`LangfuseTracing` now exposes `getCurrentTrace(): LangfuseTraceHandle | undefined`
and the returned handle has three fields:

- `traceId` and `observationId` for correlation
- `addAttributes(attributes)` to set metadata on the root
  observation
- `addEvent(name, attributes?)` to create a Langfuse `event`
  observation under the root

The handle is populated when `startRun` is called and cleared when
the run `end`s or `error`s. The handle is per-tracing-instance and
last-write-wins; concurrent runs on the same instance will race.

The langfuse adapter also implements the new `event?(...)` hook
that was added to `AgentRunObserver` in `@anvia/core`. Calling
`runObserver.event?.({ name, attributes })` creates a Langfuse
`event` observation under the active root and ends it immediately.
