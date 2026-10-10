---
"@anvia/core": minor
---

Report observer failures that the active error policy swallows instead of discarding them. Adds
`onObserverError` to `AgentObservabilityOptions` so applications can route these reports into their
own logger or silence them; the default writes one line per failure to `console.error`, and an error
thrown by the handler is ignored so a faulty sink cannot fail the run. Ignored failures are now
reported for startup (`startRun`, `startGeneration`, `startTool`) and terminal phases alike, and each
report carries the phase, observer name, and original error rather than a formatted array, so log
aggregators receive a deterministic shape. `AgentObserverErrorHandler` and
`AgentObserverFailureReport` are exported from `@anvia/core/observability`. Pipeline observer
dispatch is unchanged.
