import { PrismaDurableStore } from "../../src/prisma.js";
import { migrate, prismaOver } from "./adapters.js";
import { poolFor } from "./postgres.js";

const migrated = new WeakSet<object>();

/** `SqliteDurableStore` stand-in for the "prisma" project: a verify-only Prisma store. */
export class SqliteDurableStore extends PrismaDurableStore {
  constructor(path: string) {
    const pool = poolFor(path);
    const client = prismaOver(pool);
    const query = client.$queryRawUnsafe.bind(client);
    client.$queryRawUnsafe = async (text, ...values) => {
      if (!migrated.has(pool)) {
        migrated.add(pool);
        await migrate(pool);
      }
      return query(text, ...values);
    };
    super(client, { leaseMs: 60_000 });
  }
}
