---
"@anvia/durable": patch
---

Add validated runtime agent registration and safe removal of idle registrations. Hosts can admit new immutable configurations without closing unrelated executions, and unload archived configurations while retaining their journal history. Existing agent IDs cannot be overwritten; unfinished runs and settling attempts prevent removal.
