import { PostgresDurableStore } from "../../src/postgres.js";
import { poolFor } from "./postgres.js";

/**
 * Stands in for `SqliteDurableStore` in the "postgres" test project: the same constructor (a
 * database "path"), backed by Postgres. Reopening a path reopens the same data.
 */
export class SqliteDurableStore extends PostgresDurableStore {
  constructor(path: string) {
    super({ pool: poolFor(path) }, { schema: "create", leaseMs: 60_000 });
  }
}
