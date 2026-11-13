import { sql } from "drizzle-orm";
import type { SqlDriver, SqlQuery, SqlRow } from "./sql/driver.js";
import { SqlDurableStore, type SqlStoreOptions } from "./sql/store.js";

export * from "./drizzle-schema.js";
export type { SqlStoreOptions as DrizzleDurableStoreOptions } from "./sql/store.js";

/**
 * The part of a Drizzle Postgres database the store uses. Any `drizzle-orm` Postgres database
 * (node-postgres, postgres-js, PGlite, Neon, ...) satisfies it.
 */
export interface DrizzleDatabaseLike {
  // Parameters are `any` so every Drizzle Postgres driver's `execute` is assignable.
  // oxlint-disable-next-line typescript/no-explicit-any
  execute(query: any): PromiseLike<any>;
  // oxlint-disable-next-line typescript/no-explicit-any
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

/**
 * Durable storage through your Drizzle database. The schema is yours: define the tables with
 * `@anvia/durable/drizzle` (see `anvia-durable-drizzle init`) and migrate them with drizzle-kit.
 * `acquire()` verifies the tables and their version and throws a clear error when they are missing.
 * The store runs raw SQL through `db.execute` and `db.transaction`, with the semantics of
 * {@link PostgresDurableStore}: lease-based single ownership and one serial transaction at a time.
 */
export class DrizzleDurableStore extends SqlDurableStore {
  constructor(db: DrizzleDatabaseLike, options: Omit<SqlStoreOptions, "schema"> = {}) {
    super(drizzleDriver(db), { ...options, schema: "verify" });
  }
}

export function drizzleDriver(db: DrizzleDatabaseLike): SqlDriver {
  const run =
    (target: Pick<DrizzleDatabaseLike, "execute">): SqlQuery =>
    async (text, params = []) =>
      rowsOf(await target.execute(toSql(text, params)));
  return {
    query: run(db),
    transaction: (fn) => db.transaction((tx) => fn(run(tx))),
  };
}

/** Rewrites `$1`-style placeholders into Drizzle parameters. */
function toSql(text: string, params: readonly unknown[]) {
  const parts = text.split(/\$(\d+)/);
  const chunks = [sql.raw(parts[0]!)];
  for (let index = 1; index < parts.length; index += 2) {
    chunks.push(sql`${params[Number(parts[index]) - 1] ?? null}`, sql.raw(parts[index + 1]!));
  }
  return sql.join(chunks, sql.raw(""));
}

/** node-postgres and PGlite return `{ rows }`; postgres-js returns the rows themselves. */
function rowsOf(result: unknown): SqlRow[] {
  if (Array.isArray(result)) return result as SqlRow[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as SqlRow[]) : [];
}
