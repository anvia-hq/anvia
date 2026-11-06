---
"@anvia/durable": patch
---

Reject a registration that sets both `compaction` and `memory: { mode: "recorded" }`. Registration compaction works on the run's history, which recorded memory keeps in the memory store, so the policy would silently do nothing.
