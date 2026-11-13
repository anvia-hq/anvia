import type { SqlDriver, SqlQuery, SqlRow } from "./sql/driver.js";
import { SqlDurableStore, type SqlStoreOptions } from "./sql/store.js";

export { prismaDurableModelNames, prismaDurableSchema } from "./prisma-schema.js";

/** The raw-SQL surface of a Prisma client (or of its interactive-transaction client). */
export interface PrismaRawClient {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

/** The part of a `PrismaClient` the store uses. A generated client satisfies it. */
export interface PrismaClientLike extends PrismaRawClient {
  $transaction<T>(
    fn: (tx: never) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: never },
  ): Promise<T>;
}

export type PrismaDurableStoreOptions = Omit<SqlStoreOptions, "schema"> & {
  /**
   * Prisma's interactive transactions time out after five seconds by default, which is too short
   * for a durable journal write. Defaults: `maxWait` 10 seconds, `timeout` 60 seconds.
   */
  transaction?: { maxWait?: number; timeout?: number } | undefined;
};

/**
 * Durable storage through your Prisma client. The schema is yours: add the models from
 * `prismaDurableSchema` (`anvia-durable-prisma init` writes them) and run `prisma migrate`.
 * `acquire()` verifies the tables and their version and throws a clear error when they are missing.
 * The store runs raw SQL through `$queryRawUnsafe` inside `$transaction`, with the semantics of
 * {@link PostgresDurableStore}: lease-based single ownership and one serial transaction at a time.
 * The client must target PostgreSQL.
 */
export class PrismaDurableStore extends SqlDurableStore {
  constructor(client: PrismaClientLike, options: PrismaDurableStoreOptions = {}) {
    const { transaction, ...rest } = options;
    super(prismaDriver(client, transaction), { ...rest, schema: "verify" });
  }
}

export function prismaDriver(
  client: PrismaClientLike,
  transaction: PrismaDurableStoreOptions["transaction"] = {},
): SqlDriver {
  const run =
    (target: PrismaRawClient): SqlQuery =>
    async (text, params = []) =>
      ((await target.$queryRawUnsafe(text, ...params)) ?? []) as SqlRow[];
  return {
    query: run(client),
    transaction: (fn) =>
      client.$transaction(async (tx) => fn(run(tx as PrismaRawClient)), {
        maxWait: transaction.maxWait ?? 10_000,
        timeout: transaction.timeout ?? 60_000,
      } as never),
  };
}
