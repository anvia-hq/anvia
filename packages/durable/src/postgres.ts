import pg from "pg";
import type { SqlDriver, SqlQuery } from "./sql/driver.js";
import { POSTGRES_DDL } from "./sql/ddl.js";
import { SqlDurableStore, type SqlStoreOptions } from "./sql/store.js";

export { POSTGRES_DDL, SQL_SCHEMA_VERSION } from "./sql/ddl.js";
export type { SqlStoreOptions as PostgresDurableStoreOptions } from "./sql/store.js";

/** The part of a `pg.Pool` the store uses. `pg.Pool` satisfies it; so can a test double. */
export interface PostgresPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(error?: Error | boolean): void;
  }>;
  end?(): Promise<void>;
}

export type PostgresStoreConnection =
  | { pool: PostgresPoolLike; connectionString?: never }
  | { connectionString: string; pool?: never };

/**
 * Postgres storage for one runtime owner, over a `pg` pool you pass in or a connection string.
 *
 * - Every runtime transaction is a real `BEGIN`/`COMMIT` on one pooled connection.
 * - Ownership is a lease row (see {@link SqlStoreOptions}); a second runtime on the same database
 *   fails to open until the first closes or its lease expires.
 * - Pass `schema: "create"` to let the store create its tables; by default it only verifies them.
 *
 * A pool you pass is yours: `close()` never ends it. A pool made from `connectionString` is ended
 * by `close()`.
 */
export class PostgresDurableStore extends SqlDurableStore {
  constructor(connection: PostgresStoreConnection, options: SqlStoreOptions = {}) {
    super(postgresDriver(connection), options);
  }
}

export function postgresDriver(connection: PostgresStoreConnection): SqlDriver {
  const owned = connection.pool === undefined;
  const pool: PostgresPoolLike =
    connection.pool ?? new pg.Pool({ connectionString: connection.connectionString });
  const run = (client: Pick<PostgresPoolLike, "query">): SqlQuery => {
    return async (text, params = []) => (await client.query(text, [...params])).rows;
  };
  return {
    query: run(pool),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        try {
          const result = await fn(run(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            broken = true;
          }
          throw error;
        }
      } finally {
        client.release(broken);
      }
    },
    async close() {
      if (owned) await pool.end?.();
    },
  };
}

/** Idempotent DDL for the tables the store uses, for use in your own migration tooling. */
export const postgresSchemaSql = `${POSTGRES_DDL.join(";\n\n")};\n`;
