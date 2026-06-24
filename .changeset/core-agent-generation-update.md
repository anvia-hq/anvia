---
"@anvia/core": minor
---

Add an optional `update?` hook on `AgentGenerationObserver` so
observability adapters can record streaming deltas as they arrive.

The agent loop now awaits `observer.update?.({ turn, delta })` for
every delta produced by the underlying completion stream. The new
method is optional, so existing adapters keep working. A new
`AgentGenerationUpdateArgs` type is exported alongside.
