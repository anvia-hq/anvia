import type { JsonObject, JsonValue, Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";

export type PrismaMemoryErrorMode = "store" | "ignore";

export type PrismaMemoryScopeOptions = {
  includeUserId?: boolean | undefined;
  metadataKeys?: string[] | undefined;
};

export type PrismaMemoryTransactionOptions = {
  isolationLevel?: string | undefined;
};

export type PrismaMemoryStoreOptions = {
  scope?: PrismaMemoryScopeOptions | ((context: MemoryContext) => string) | undefined;
  errors?: PrismaMemoryErrorMode | undefined;
  validateMessages?: boolean | undefined;
  transaction?: PrismaMemoryTransactionOptions | undefined;
};

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
};

export type PrismaMemoryMessageDelegate = {
  findMany(args: unknown): Promise<PrismaMemoryMessageRow[]>;
  findFirst(args: unknown): Promise<PrismaMemoryPositionRow | null>;
  createMany(args: unknown): Promise<unknown>;
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

export type PrismaMemorySessionCreateData = {
  scopeKey: string;
  sessionId: string;
  userId?: string | undefined;
  metadata: JsonObject;
};

export type PrismaMemoryAppendData = {
  memorySessionId: string;
  runId: string;
  turn: number;
  position: number;
  role: Message["role"];
  message: Message;
};

export type PrismaMemoryErrorData = {
  memorySessionId: string;
  runId: string;
  error: JsonValue;
  messages: Message[];
};

export type PrismaMemoryAppendInput = MemoryAppendInput;
export type PrismaMemoryContext = MemoryContext;
export type PrismaMemoryErrorInput = MemoryErrorInput;
