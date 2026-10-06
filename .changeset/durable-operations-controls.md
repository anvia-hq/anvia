---
"@anvia/durable": minor
"@anvia/client": minor
"@anvia/server": minor
---

Fail closed on durable storage errors across agent and custom-task execution. Add readiness,
aggregate metrics, configurable admission/payload/operation limits, and offline SQLite backup
and restoration to new files. Durable now requires Node.js 22.16 or newer and custom stores
must implement capacity-count and metrics methods.

Expose registered custom-task submission, snapshots, ownership graphs, signals, effect
reconciliation, retry, cancellation, and reconnectable events through the server and browser
client. Map owned agent authorization to its parent session and include root task identity
in task event envelopes. The durable package remains experimental.
