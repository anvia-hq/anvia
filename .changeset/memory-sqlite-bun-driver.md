---
"@anvia/memory-sqlite": minor
---

Add Bun support. `SqliteMemoryClient` now loads `bun:sqlite` automatically when
running under Bun (and enforces the `foreign_keys` pragma that driver cannot set
at open time), falling back to `node:sqlite` elsewhere. `SqliteMemoryDatabaseLike`
is now a structural driver surface, so either built-in driver or a compatible
custom implementation can be injected through `{ database }`. Row lookups also
treat `null` and `undefined` as the same no-row sentinel, fixing first-append
crashes on drivers that return `null` for missing rows.
