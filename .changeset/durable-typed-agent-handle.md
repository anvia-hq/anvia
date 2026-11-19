---
"@anvia/durable": minor
---

Add `runtime.agent(registration)` and `runtime.handle(agent)`, which return a `DurableAgentHandle` that submits without an `agentId` string and returns a `DurableRun<Output>` typed from the agent. `DurableRun.result()` now accepts `onBlocked: "throw"` to reject with the new `DurableBlockedError` when a run needs attention, instead of waiting for an operator. The default behaviour is unchanged.
