import type { MemoryAppendOptions, MemoryErrorOptions, MemoryScope } from "@anvia/core/memory";
import type { drizzleMemorySchema } from "./schema.js";

export type DrizzleMemoryErrorMode = "store" | "ignore";
export type DrizzleMemoryLockMode = "advisory" | "none";

export type DrizzleMemoryDatabaseLike = object;
export type DrizzleMemorySchema = typeof drizzleMemorySchema;

export type DrizzleMemoryScopeOptions = {
  includeUserId?: boolean | undefined;
  metadataKeys?: string[] | undefined;
};

export type DrizzleMemoryStoreOptions = {
  schema?: DrizzleMemorySchema | undefined;
  scope?: DrizzleMemoryScopeOptions | ((context: MemoryScope) => string) | undefined;
  errors?: DrizzleMemoryErrorMode | undefined;
  validateMessages?: boolean | undefined;
  lock?: DrizzleMemoryLockMode | undefined;
};

export type DrizzleMemoryAppendOptions = MemoryAppendOptions;
export type DrizzleMemoryScope = MemoryScope;
export type DrizzleMemoryErrorOptions = MemoryErrorOptions;
