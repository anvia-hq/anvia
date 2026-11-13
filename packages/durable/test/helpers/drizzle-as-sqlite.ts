import { DrizzleDurableStore } from "../../src/drizzle.js";
import { drizzleOver, migrate } from "./adapters.js";
import { poolFor } from "./postgres.js";

/** `SqliteDurableStore` stand-in for the "drizzle" project: a verify-only Drizzle store. */
export class SqliteDurableStore extends DrizzleDurableStore {
  constructor(path: string) {
    const pool = poolFor(path);
    super(
      {
        ...drizzleOver(pool),
        // Migrate lazily, before the first statement, as a migration tool would.
        execute: lazy(pool, drizzleOver(pool).execute),
        transaction: drizzleOver(pool).transaction,
      },
      { leaseMs: 60_000 },
    );
  }
}

const migrated = new WeakSet<object>();
function lazy(
  pool: Parameters<typeof migrate>[0],
  execute: ReturnType<typeof drizzleOver>["execute"],
) {
  return async (query: never) => {
    if (!migrated.has(pool)) {
      migrated.add(pool);
      await migrate(pool);
    }
    return execute(query);
  };
}
