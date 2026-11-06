---
"@anvia/memory-drizzle": patch
---

Make keyed and versioned appends safe under `lock: "none"`. Writers racing on one `expectedVersion` could all commit. The append now upserts the session row first, so its row lock keeps writers on one scope in turn. The default advisory lock is unchanged.
