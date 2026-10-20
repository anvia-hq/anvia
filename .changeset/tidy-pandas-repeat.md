---
"@anvia/core": patch
---

In-memory vector store `inspect` now validates its cursor with a strict non-negative integer parser (`parseVectorInspectCursor`, also exported from `@anvia/core/vector-store`). Invalid cursors such as `"abc"`, `"-1"`, `"1.5"`, `"1e999"`, or values outside the safe-integer range now throw a `RangeError` instead of silently replaying the first page or returning an empty page.
