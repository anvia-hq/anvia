---
"@anvia/core": minor
"@anvia/durable": minor
---

Add experimental SQLite-backed durable agent execution with deduplicated submissions,
model/tool checkpoints, restart recovery, persisted approvals, and reconnectable progress
events. Interrupted tools require reconciliation unless explicitly declared safe to repeat
or backed by external idempotency. Add core execution boundaries and stable tool operation
IDs while preserving direct agent execution behavior.

External documentation should introduce the durable execution package and explain its
single-owner scope, supported agent features, recovery policies, and progress-event API.
