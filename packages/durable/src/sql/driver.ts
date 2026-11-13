/** One result row, keyed by column name. */
export type SqlRow = Record<string, unknown>;

/**
 * Runs one parameterized statement. Placeholders are numbered (`$1`, `$2`, ...) and every
 * parameter is a string, number, boolean or null. The store casts parameters in the SQL text
 * (`$1::bigint`), so a driver never has to infer a type.
 */
export type SqlQuery = (text: string, params?: readonly unknown[]) => Promise<SqlRow[]>;

/** The only thing the SQL store needs from a Postgres client library. */
export interface SqlDriver {
  /** A single statement outside any transaction. */
  query: SqlQuery;
  /** Runs `fn` between BEGIN and COMMIT on one connection; rolls back when `fn` throws. */
  transaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T>;
  /** Releases resources the driver created itself. Never ends a pool the caller owns. */
  close?(): Promise<void>;
}
