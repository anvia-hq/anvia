---
"@anvia/durable": patch
---

Add schema-validated, versioned custom tasks with persisted checkpoints, dynamic child ownership,
all-settled and fail-fast joins, owned Anvia agent runs, and inspectable task trees. Add durable
named signals and timers, conservative external-effect journaling and reconciliation, fair phase
scheduling, and checkpoint migrations. Extend the store contract and upgrade SQLite to schema 3.
Custom-task APIs are currently in-process; the package remains experimental.
