---
"@anvia/durable": minor
"@anvia/server": minor
"@anvia/client": minor
---

Add persisted static task graphs with validated dependencies, parallel ready tasks, successful
prerequisite gating, and committed dependency outputs. Expose atomic topology/state snapshots,
explicit waiting reasons, correlated task events, graph discovery, and cancellation.

Add graph HTTP/client methods and authorize child-run access against the owning graph session.
Upgrade SQLite schema 1 to 2 on acquisition so older engines cannot bypass dependency scheduling.
Document automatic readiness/recovery versus explicit approvals and reconciliation, with
SIGKILL recovery and authorization test coverage.
