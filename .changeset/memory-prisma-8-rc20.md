---
"@anvia/memory-prisma": minor
---

The Prisma 8 (`@anvia/memory-prisma/v8`) integration now targets `@prisma/orm-postgres` `8.0.0-rc.20` with the `prisma@8.0.0-rc.27` CLI. The generated contract uses `@onCreate(cuid(2))` for new IDs instead of `@default(cuid(2))`, and `anvia-memory-prisma init --prisma-version 8` starts a new contract with the `// use prisma-8` directive that this CLI requires. When appending to an existing contract that lacks the directive, `init` warns instead of editing it. On the runtime side, create the client with `contract: contractFromJson<Contract>(contractJson)` from `@prisma/orm-postgres/static` instead of `contractJson`. Existing Prisma 8 users should update their contract's ID defaults and re-run `prisma contract emit`.
