---
"@anvia/durable": patch
---

Document that the SQLite, Postgres, Prisma and Drizzle memory adapters implement the versioned contract that recorded memory needs. Adds end-to-end tests of recorded memory against the SQLite adapter and a process-kill test of a memory write. No behaviour changes.
