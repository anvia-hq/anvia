import type { MemoryScopeKeyResolver } from "@anvia/core/memory";

export type PrismaMemoryErrorPolicy = "store" | "ignore";

export type PrismaMemoryTransactionOptions = {
  isolationLevel?: string | undefined;
};

type PrismaMemoryStoreBaseOptions = {
  scopeKey?: MemoryScopeKeyResolver | undefined;
  errorPolicy?: PrismaMemoryErrorPolicy | undefined;
  validateMessages?: boolean | undefined;
  transaction?: PrismaMemoryTransactionOptions | undefined;
};

export type PrismaMemoryStoreOptions = PrismaMemoryStoreBaseOptions &
  (
    | {
        client: object;
        delegates?: never;
      }
    | {
        delegates: PrismaMemoryDelegates;
        client?: never;
      }
  );

export type PrismaMemorySessionRow = {
  id: string;
};

export type PrismaMemoryMessageRow = {
  message: unknown;
};

export type PrismaMemoryPositionRow = {
  position: number;
};

export type PrismaMemorySessionDelegate = {
  upsert(args: unknown): Promise<PrismaMemorySessionRow>;
  deleteMany(args: unknown): Promise<unknown>;
  findMany?(args: unknown): Promise<unknown[]>;
  findUnique?(args: unknown): Promise<unknown | null>;
};

export type PrismaMemoryMessageDelegate = {
  findMany(args: unknown): Promise<PrismaMemoryMessageRow[]>;
  findFirst(args: unknown): Promise<PrismaMemoryPositionRow | null>;
  createMany(args: unknown): Promise<unknown>;
  deleteMany?(args: unknown): Promise<{ count: number }>;
};

export type PrismaMemoryErrorDelegate = {
  create(args: unknown): Promise<unknown>;
};

export type PrismaMemoryDelegates = {
  sessions: PrismaMemorySessionDelegate;
  messages: PrismaMemoryMessageDelegate;
  errors?: PrismaMemoryErrorDelegate | undefined;
  transaction<T>(
    operation: (tx: PrismaMemoryDelegates) => Promise<T>,
    options?: PrismaMemoryTransactionOptions | undefined,
  ): Promise<T>;
};

export type PrismaMemoryConventionalDelegates = {
  agentMemorySession: PrismaMemorySessionDelegate;
  agentMemoryMessage: PrismaMemoryMessageDelegate;
  agentMemoryError?: PrismaMemoryErrorDelegate | undefined;
};

export type PrismaMemoryClientLike = PrismaMemoryConventionalDelegates & {
  $transaction<T>(
    operation: (tx: PrismaMemoryConventionalDelegates) => Promise<T>,
    options?: PrismaMemoryTransactionOptions | undefined,
  ): Promise<T>;
};
