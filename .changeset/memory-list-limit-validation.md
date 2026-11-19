---
"@anvia/memory-sqlite": patch
"@anvia/memory-postgres": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-prisma": patch
---

Reject a conversation list limit that is not a positive safe integer, so a negative limit can no longer read every conversation on SQLite or fail differently on the other stores.
