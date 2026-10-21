---
"@anvia/acp": minor
---

Add optional `@anvia/acp/durable` session bindings with persisted approvals, explicit recovery,
and reattachment after disconnects and process restarts without repeating completed effects.

Durable sessions detach on close and preserve existing registration limits. Connection-owned
editor/MCP tools are unsupported; host-owned mutations need manual recovery or service-enforced
idempotency using the stable operation ID.
