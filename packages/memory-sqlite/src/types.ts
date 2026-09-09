import type { MemoryScopeKeyResolver } from "@anvia/core/memory";

/**
 * Structural surface of the synchronous SQLite drivers this package supports
 * (node:sqlite `DatabaseSync` and bun:sqlite `Database`). It is structural so
 * either driver, or a compatible custom implementation, can be injected.
 */
export type SqliteMemoryDatabaseLike = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(parameters?: Record<string, unknown>): unknown[];
    get(parameters?: Record<string, unknown>): unknown;
    run(parameters?: Record<string, unknown>): unknown;
  };
  close(): void;
};

export type SqliteMemoryClientOptions =
  | {
      path: string;
      database?: never;
    }
  | {
      database: SqliteMemoryDatabaseLike;
      path?: never;
    };

export type SqliteMemoryErrorPolicy = "store" | "ignore";

export type SqliteMemoryTableNames = {
  sessions?: string | undefined;
  messages?: string | undefined;
  errors?: string | undefined;
  messagesPositionIndex?: string | undefined;
};

export type SqliteMemorySchemaOptions = {
  tablePrefix?: string | undefined;
  tableNames?: SqliteMemoryTableNames | undefined;
};

export type SqliteMemoryStoreOptions = SqliteMemorySchemaOptions & {
  scopeKey?: MemoryScopeKeyResolver | undefined;
  errorPolicy?: SqliteMemoryErrorPolicy | undefined;
  validateMessages?: boolean | undefined;
};
