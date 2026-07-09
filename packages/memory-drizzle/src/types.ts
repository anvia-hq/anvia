import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
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
  scope?: DrizzleMemoryScopeOptions | ((context: MemoryContext) => string) | undefined;
  errors?: DrizzleMemoryErrorMode | undefined;
  validateMessages?: boolean | undefined;
  lock?: DrizzleMemoryLockMode | undefined;
};

export type DrizzleMemoryAppendInput = MemoryAppendInput;
export type DrizzleMemoryContext = MemoryContext;
export type DrizzleMemoryErrorInput = MemoryErrorInput;
