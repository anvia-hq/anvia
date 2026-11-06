# memory-postgres-integration

Runs the versioned, idempotent memory contract of `@anvia/memory-postgres` and
`@anvia/memory-drizzle` against a real PostgreSQL server, including writers that race on one
version or one key. The tests are skipped unless `ANVIA_POSTGRES_TEST_URL` is set. Each run creates
and drops its own database; the supplied database is never changed.

```sh
ANVIA_POSTGRES_TEST_URL=postgresql://postgres@127.0.0.1:5432/postgres \
  pnpm --filter memory-postgres-integration test:postgres
```
