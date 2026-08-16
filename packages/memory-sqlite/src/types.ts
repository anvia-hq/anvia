import type { DatabaseSync } from "node:sqlite";
import type { MemoryScopeKeyResolver } from "@anvia/core/memory";

export type SqliteMemoryDatabaseLike = DatabaseSync;

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
