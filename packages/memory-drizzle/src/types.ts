import type { MemoryScopeKeyResolver } from "@anvia/core/memory";
import type { agentMemoryWrites, drizzleMemorySchema } from "./schema.js";

export type DrizzleMemoryErrorPolicy = "store" | "ignore";
export type DrizzleMemoryLockMode = "advisory" | "none";

export type DrizzleMemoryDatabaseLike = object;
/**
 * `agentMemoryWrites` is optional so an app that has not migrated the idempotency table yet can
 * keep passing its existing three-table schema. Keyed appends require it.
 */
export type DrizzleMemorySchema = Omit<typeof drizzleMemorySchema, "agentMemoryWrites"> & {
  agentMemoryWrites?: typeof agentMemoryWrites | undefined;
};

export type DrizzleMemoryStoreOptions = {
  db: DrizzleMemoryDatabaseLike;
  schema?: DrizzleMemorySchema | undefined;
  scopeKey?: MemoryScopeKeyResolver | undefined;
  errorPolicy?: DrizzleMemoryErrorPolicy | undefined;
  validateMessages?: boolean | undefined;
  lock?: DrizzleMemoryLockMode | undefined;
};
