---
"@anvia/memory-prisma": minor
---

Add a `/v8` entrypoint for Prisma 8 PostgreSQL memory, including Studio inspection,
transactional compaction, and custom model mappings. Preserve Prisma 7 support at
the root entrypoint and make each Prisma runtime peer optional independently.

Add explicit Prisma 8 contract setup to the init CLI and document reuse of existing
Prisma 7 memory tables. Prisma 7 CLI guidance now pins its major version and
recognizes `prisma7.config` files for side-by-side installations.
