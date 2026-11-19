---
"@anvia/durable": minor
---

Add per-run claims to the SQL (Postgres, Drizzle, Prisma) stores: `join()`, `claim()`, `renew()`, `release()` and `tx.assertClaim()`, backed by a new `anvia_durable_claims` table, with `DurableClaimLostError`. An owning runtime and shared workers exclude each other. The runtime does not use claims yet. Drizzle and Prisma users should add the new table to their schema (the generators include it) before using `join()`; owner-only databases keep working without it.
