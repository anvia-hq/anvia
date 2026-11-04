---
"@anvia/durable": minor
---

Make the durable agent contract honest for agent-level retries and unsupported features.

- Registering an agent whose resolved options define `retries` now throws a `TypeError` naming the
  agent and pointing at the registration's `modelRetry`. Previously the runtime forced
  `retries: false` on every run, so the setting looked effective but never applied. `retries:
false`, `retries: 0`, and `retries: { maxAttempts: 1 }` are accepted because they never retry.
- The combined registration rejection now lists only the feature groups the agent actually sets
  (memory, lifecycle, middleware, guardrails, context, MCP servers, provider tools, tool indexes)
  instead of all eight.
- Add `runtime.compatibility()` and the `DurableRuntimeOptions.onCompatibility` callback, which
  report `agentId`, `version`, static tool names, `streaming`, `compaction`, `modelRetry`, `frozen`
  agent options, and the per-run settings durable does not expose. The callback fires after
  `open()` and after each successful `registerAgents()`, and every report is a detached copy.
- Document that `skills` are supported because they flatten into static instructions and tools.

No new agent features are supported; this release makes rejection and reporting explicit.
