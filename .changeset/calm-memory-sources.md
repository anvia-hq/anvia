---
"@anvia/core": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-postgres": patch
"@anvia/memory-prisma": patch
"@anvia/memory-sqlite": patch
"@anvia/studio": patch
---

Add optional read-only memory inspection, implement it across the database memory adapters, and let
Studio discover persisted agent conversations before falling back to Studio session storage.
