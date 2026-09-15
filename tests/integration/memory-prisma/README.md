# Prisma memory compatibility

Tests the built package with Prisma 7.10.0 and Prisma 8 PostgreSQL 8.0.0-rc.11
(CLI 8.0.0-rc.15). Run with Node 24.11+ and PostgreSQL 17:

```sh
pnpm --filter @anvia/core build
pnpm --filter @anvia/memory-prisma build
ANVIA_PRISMA_TEST_URL=postgresql://postgres@localhost:5432/postgres \
  TZ=Asia/Jakarta pnpm --filter memory-prisma-integration test:postgres
pnpm --filter memory-prisma-integration exec tsc --noEmit
```

The database user must be able to create databases. Each schema-owner suite creates a
randomly named database, applies the generated memory schema, and drops that database
after closing its clients. The database in the supplied URL is only used as the admin
connection; its tables are not modified. Use a local or disposable PostgreSQL service.

Without `ANVIA_PRISMA_TEST_URL`, `pnpm test` generates the clients and skips database tests.
`pnpm typecheck` also generates fixtures before checking real-client compatibility.
The dedicated CI job runs both database suites in a non-UTC process timezone.

Fixtures are generated from the package's Prisma 7 schema and Prisma 8 contract, including
a second contract with custom model names mapped to the same tables. `generated/` and the
Prisma 8 CLI's local `migrations/` snapshots are ignored.
The Prisma 7 CLI uses an npm alias and is called by its own path so its `prisma` binary
cannot be confused with the Prisma 8 CLI. Generated artifacts should not be committed.
