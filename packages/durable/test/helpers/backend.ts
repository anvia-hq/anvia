import { it } from "vitest";

/** True in the "postgres" test project, where `SqliteDurableStore` is backed by Postgres. */
export const onPostgres = process.env.ANVIA_TEST_STORE === "postgres";

/**
 * For scenarios that open the SQLite file directly, back it up, change its schema version, or kill
 * a child process holding it. They test SQLite itself and are skipped for Postgres.
 */
export const itSqlite = (onPostgres ? it.skip : it) as typeof it;
