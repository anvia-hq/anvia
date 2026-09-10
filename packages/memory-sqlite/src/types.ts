import type { MemoryScopeKeyResolver } from "@anvia/core/memory";

/**
 * Parameter values accepted by every supported synchronous SQLite driver
 * (node:sqlite `DatabaseSync` and bun:sqlite `Database`). It is the common
 * subset of the drivers' binding unions, so either driver can be injected
 * without a cast.
 */
export type SqliteMemoryBindingValue = bigint | null | number | string | Uint8Array;

type SqliteMemoryStatementLike = {
  all(): unknown[];
  all(parameters: Record<string, SqliteMemoryBindingValue>): unknown[];
  get(): unknown;
  get(parameters: Record<string, SqliteMemoryBindingValue>): unknown;
  run(): unknown;
  run(parameters: Record<string, SqliteMemoryBindingValue>): unknown;
};

/**
 * Structural surface of the synchronous SQLite drivers this package supports
 * (node:sqlite `DatabaseSync` and bun:sqlite `Database`). It is structural so
 * either driver, or a compatible custom implementation, can be injected.
 */
export type SqliteMemoryDatabaseLike = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteMemoryStatementLike;
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
