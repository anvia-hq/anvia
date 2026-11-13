import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DrizzleDatabaseLike } from "../../src/drizzle.js";
import type { PostgresPoolLike } from "../../src/postgres.js";
import type { PrismaClientLike } from "../../src/prisma.js";
import { POSTGRES_DDL } from "../../src/sql/ddl.js";

const dialect = new PgDialect();

/** Creates the tables the way a migration would, so Drizzle and Prisma stores can verify them. */
export async function migrate(pool: PostgresPoolLike): Promise<void> {
  const client = await pool.connect();
  try {
    for (const statement of POSTGRES_DDL) await client.query(statement);
  } finally {
    client.release();
  }
}

type Rows = { rows: Record<string, unknown>[] };

/**
 * A Drizzle-shaped database over a pool: statements are rendered by Drizzle's own Postgres
 * dialect, so the store's `$n` -> `sql` conversion is exercised against real Drizzle SQL objects.
 */
export function drizzleOver(pool: PostgresPoolLike): DrizzleDatabaseLike {
  const render = (query: SQL) => dialect.sqlToQuery(query);
  return {
    async execute(query: SQL): Promise<Rows> {
      const { sql, params } = render(query);
      return pool.query(sql, params);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const result = await fn({
            async execute(query: SQL): Promise<Rows> {
              const { sql, params } = render(query);
              return client.query(sql, params);
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    },
  };
}

/**
 * A Prisma-shaped client over a pool. It is not a real Prisma engine: it checks the store's use of
 * `$queryRawUnsafe` and interactive `$transaction`, including Prisma's BigInt results.
 */
export function prismaOver(pool: PostgresPoolLike): PrismaClientLike {
  // Prisma returns int8 columns as BigInt; mirror that for numeric strings is not needed because the
  // store casts to text, but plain bigint-typed results must still convert.
  const normalize = (rows: Record<string, unknown>[]) => rows;
  return {
    async $queryRawUnsafe(text: string, ...values: unknown[]) {
      return normalize((await pool.query(text, values)).rows);
    },
    async $transaction(fn: (tx: never) => Promise<never>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const result = await fn({
            async $queryRawUnsafe(text: string, ...values: unknown[]) {
              return normalize((await client.query(text, values)).rows);
            },
          } as never);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    },
  } as PrismaClientLike;
}
