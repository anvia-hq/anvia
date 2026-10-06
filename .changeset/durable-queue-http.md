---
"@anvia/durable": patch
"@anvia/server": minor
"@anvia/client": minor
---

Add paginated durable run discovery, opt-in persisted session queues, bounded concurrency,
and opt-in model retries with persisted attempt budgets and backoff deadlines. Capture queued
session history only when execution starts and preserve conservative tool recovery policies.

Add authorized Fetch-compatible durable HTTP routes and a browser-safe client with validated
snapshots and cursor-based SSE reconnection. Add native SSE event IDs and producer cancellation
callbacks to server stream helpers. Preserve node:sqlite imports in the durable package build.

Document the scheduling and HTTP contracts. External documentation should include the new subpath exports,
queue/retry statuses, authorization boundary, and reconnect flow.
