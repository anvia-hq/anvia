---
"@anvia/durable": patch
---

Include a tool index's embedding model and embedded text in its fingerprint. A run submitted before this change records a different hash than the same registration produces afterwards, so an in-flight run resumed across the upgrade fails with `needs_attention` and needs its registration version bumped.
