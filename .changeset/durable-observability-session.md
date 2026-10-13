---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Group durable work under an application-chosen observability session. Durable `trace` options accept `sessionId`, which observers such as Lens use to group traces, for example every turn, goal round, subagent, retry, and resumed attempt of one chat. Task-owned runs, including goal rounds and spawned subagents, use the root task's value. It only affects observers: execution sessions, histories, and ownership stay separate, each run keeps its own trace, and `metadata.durableSessionId` records the execution session when the two differ. Without it, the submitted session is used as before. Application `trace.metadata` keys named after runtime-owned durable keys (`durableRunId`, `durableEpoch`, `durableSessionId`, `durableTaskId`, `durableRootTaskId`, `durableGraphId`) are now always dropped, so they cannot pose as runtime identifiers on runs where the runtime does not set them. `createDurableHandler()`'s `trace(request, resource)` hook can return it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.12.
