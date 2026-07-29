import type { JsonObject, Message, SystemMessage, Usage } from "../completion/types";

export type MemorySavePolicy = "message" | "turn" | "run";

export type MemoryContext = {
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type MemoryAppendInput = {
  context: MemoryContext;
  runId: string;
  turn: number;
  messages: Message[];
};

export type MemoryErrorInput = {
  context: MemoryContext;
  runId: string;
  error: unknown;
  messages: Message[];
};

export type MemoryConversationListOptions = {
  limit: number;
  userId?: string | undefined;
};

export type MemoryConversationSummary = {
  /** Opaque, store-specific reference used to retrieve this exact conversation. */
  ref: string;
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type MemoryConversationMessage = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string;
  message: Message;
};

export type MemoryConversation = MemoryConversationSummary & {
  messages: MemoryConversationMessage[];
};

/** Optional, read-only discovery surface for developer tooling such as Studio. */
export interface MemoryInspector {
  listConversations(options: MemoryConversationListOptions): Promise<MemoryConversationSummary[]>;
  getConversation(ref: string): Promise<MemoryConversation | undefined>;
}

export interface MemoryStore {
  readonly inspector?: MemoryInspector | undefined;
  readonly compaction?: MemoryCompactionStore | undefined;
  load(context: MemoryContext): Promise<Message[]>;
  append(input: MemoryAppendInput): Promise<void>;
  clear(context: MemoryContext): Promise<void>;
  recordError?(input: MemoryErrorInput): Promise<void>;
}

export type MemoryCompactionSnapshot = {
  /** Opaque store revision used to reject stale compaction commits. */
  revision: string;
  messages: Message[];
};

export type MemoryCompactionCommitInput = {
  context: MemoryContext;
  revision: string;
  compactedMessageCount: number;
  summary: SystemMessage;
  runId: string;
};

export type MemoryCompactionCommitResult = "committed" | "conflict";

/** Optional durable prefix-replacement capability used by automatic memory compaction. */
export interface MemoryCompactionStore {
  load(context: MemoryContext): Promise<MemoryCompactionSnapshot>;
  commit(input: MemoryCompactionCommitInput): Promise<MemoryCompactionCommitResult>;
}

export type MemoryCompactorInput = {
  context: MemoryContext;
  messages: Message[];
};

export type MemoryCompactorResult = {
  summary: string;
  usage?: Usage | undefined;
};

export type MemoryCompactor = (input: MemoryCompactorInput) => Promise<MemoryCompactorResult>;

export type SummaryMemoryCompactorOptions = {
  instructions?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
};

export type MemoryCompactionOptions = {
  maxMessages: number;
  keepRecentUserTurns?: number | undefined;
  compactor: MemoryCompactor;
  conflictRetries?: number | undefined;
};

export type ResolvedMemoryCompactionOptions = {
  maxMessages: number;
  keepRecentUserTurns: number;
  compactor: MemoryCompactor;
  conflictRetries: number;
};

export type MemoryOptions = {
  savePolicy?: MemorySavePolicy | undefined;
  compaction?: MemoryCompactionOptions | undefined;
};

export type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
  compaction?: ResolvedMemoryCompactionOptions | undefined;
};

export type MemoryRegistration = {
  store: MemoryStore;
  options: ResolvedMemoryOptions;
};

export type SessionOptions = {
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};
