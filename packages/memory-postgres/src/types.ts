import type { MemoryScopeKeyResolver } from "@anvia/core/memory";

export type PostgresMemoryErrorPolicy = "store" | "ignore";
export type PostgresMemoryLockMode = "advisory" | "none";

export type PostgresMemoryQueryResult = {
  rows: Record<string, unknown>[];
};

export type PostgresMemoryClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<PostgresMemoryQueryResult>;
  end?(): Promise<void>;
};

export type PostgresMemoryTransactionClientLike = PostgresMemoryClientLike & {
  release(): void;
};

export type PostgresMemoryPoolLike = PostgresMemoryClientLike & {
  connect(): Promise<PostgresMemoryTransactionClientLike>;
};

export type PostgresMemoryClientOptions =
  | {
      connectionString: string;
      client?: never;
    }
  | {
      client: PostgresMemoryClientLike;
      connectionString?: never;
    };

export type PostgresMemoryTableNames = {
  sessions?: string | undefined;
  messages?: string | undefined;
  errors?: string | undefined;
};

export type PostgresMemorySchemaOptions = {
  tablePrefix?: string | undefined;
  tableNames?: PostgresMemoryTableNames | undefined;
};

export type PostgresMemoryStoreOptions = PostgresMemorySchemaOptions & {
  scopeKey?: MemoryScopeKeyResolver | undefined;
  errorPolicy?: PostgresMemoryErrorPolicy | undefined;
  validateMessages?: boolean | undefined;
  lock?: PostgresMemoryLockMode | undefined;
};
