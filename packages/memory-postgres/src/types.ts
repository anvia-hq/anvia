import type { MemoryAppendOptions, MemoryErrorOptions, MemoryScope } from "@anvia/core/memory";

export type PostgresMemoryErrorMode = "store" | "ignore";
export type PostgresMemoryLockMode = "advisory" | "none";

export type PostgresMemoryQueryResult = {
  rows: Record<string, unknown>[];
};

export type PostgresMemoryClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<PostgresMemoryQueryResult>;
};

export type PostgresMemoryTransactionClientLike = PostgresMemoryClientLike & {
  release(): void;
};

export type PostgresMemoryPoolLike = PostgresMemoryClientLike & {
  connect(): Promise<PostgresMemoryTransactionClientLike>;
};

export type PostgresMemoryScopeOptions = {
  includeUserId?: boolean | undefined;
  metadataKeys?: string[] | undefined;
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
  client?: PostgresMemoryClientLike | undefined;
  connectionString?: string | undefined;
  createIfMissing?: boolean | undefined;
  scope?: PostgresMemoryScopeOptions | ((context: MemoryScope) => string) | undefined;
  errors?: PostgresMemoryErrorMode | undefined;
  validateMessages?: boolean | undefined;
  lock?: PostgresMemoryLockMode | undefined;
};

export type PostgresMemoryAppendOptions = MemoryAppendOptions;
export type PostgresMemoryScope = MemoryScope;
export type PostgresMemoryErrorOptions = MemoryErrorOptions;
