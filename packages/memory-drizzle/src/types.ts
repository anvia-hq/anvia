import type { MemoryScopeKeyResolver } from "@anvia/core/memory";
import type { drizzleMemorySchema } from "./schema.js";

export type DrizzleMemoryErrorPolicy = "store" | "ignore";
export type DrizzleMemoryLockMode = "advisory" | "none";

export type DrizzleMemoryDatabaseLike = object;
export type DrizzleMemorySchema = typeof drizzleMemorySchema;

export type DrizzleMemoryStoreOptions = {
  db: DrizzleMemoryDatabaseLike;
  schema?: DrizzleMemorySchema | undefined;
  scopeKey?: MemoryScopeKeyResolver | undefined;
  errorPolicy?: DrizzleMemoryErrorPolicy | undefined;
  validateMessages?: boolean | undefined;
  lock?: DrizzleMemoryLockMode | undefined;
};
