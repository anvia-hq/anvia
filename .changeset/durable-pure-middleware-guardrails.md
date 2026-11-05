---
"@anvia/durable": minor
---

Admit middleware and guardrails. Set `middlewares: { mode: "pure" }` on a registration to admit the agent's middleware, which must be deterministic and free of external effects; replay compares the transformed request or tool input with the persisted one and fails with a recovery error if it changed. Set `guardrails: { mode: "record" }` to admit guardrail policies: each check's outcome is recorded before it is applied, and a restart reuses it. A blocking input decision is a terminal outcome. A check that threw is run again after `retry()`. Two checks with the same id in one policy are rejected at registration. Without the markers both features are still rejected at registration, and the error names the marker.
