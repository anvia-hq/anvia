import type {
  CompletionModel,
  JsonObject,
  Message,
  SystemMessage,
  Usage,
} from "../completion/types";
import type { RetrySetting } from "../retry";

export type MemorySavePolicy = "message" | "turn" | "run";

export type MemoryScope = {
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type MemoryScopeKeyOptions = {
  includeUserId?: boolean | undefined;
  metadataKeys?: readonly string[] | undefined;
};

export type CreateMemoryScopeKeyOptions = MemoryScopeKeyOptions & {
  scope: MemoryScope;
};

export type MemoryScopeKeyResolver =
  | MemoryScopeKeyOptions
  | ((options: { scope: MemoryScope }) => string);

export type MemoryLoadOptions = {
  scope: MemoryScope;
};

export type MemoryAppendOptions = {
  scope: MemoryScope;
  runId: string;
  turn: number;
  messages: Message[];
};

export type MemoryClearOptions = {
  scope: MemoryScope;
};

export type MemoryErrorOptions = {
  scope: MemoryScope;
  runId: string;
  error: unknown;
  messages: Message[];
};

export type MemoryConversationListOptions = {
  limit: number;
  userId?: string | undefined;
};

export type MemoryConversationGetOptions = {
  ref: string;
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
  getConversation(options: MemoryConversationGetOptions): Promise<MemoryConversation | undefined>;
}

export interface MemoryStore {
  readonly inspector?: MemoryInspector | undefined;
  readonly compaction?: MemoryCompactionCapability | undefined;
  load(options: MemoryLoadOptions): Promise<Message[]>;
  append(options: MemoryAppendOptions): Promise<void>;
  clear(options: MemoryClearOptions): Promise<void>;
  recordError?(options: MemoryErrorOptions): Promise<void>;
}

export type MemoryCompactionMetadata = {
  version: 1;
  compactedMessageCount: number;
};

export type MemoryCompactionMessage = Omit<SystemMessage, "metadata"> & {
  metadata: {
    anvia: {
      memoryCompaction: MemoryCompactionMetadata;
    };
  };
};

export type MemoryCompactionSnapshot = {
  /** Opaque store revision used to reject stale compaction replacements. */
  revision: string;
  messages: Message[];
};

export type MemoryCompactionSnapshotOptions = {
  scope: MemoryScope;
};

export type MemoryCompactionReplacePrefixOptions = {
  scope: MemoryScope;
  revision: string;
  messageCount: number;
  replacement: MemoryCompactionMessage;
  runId: string;
};

export type MemoryCompactionReplacePrefixResult = {
  status: "committed" | "conflict";
};

/** Optional atomic prefix-replacement capability used by automatic memory compaction. */
export interface MemoryCompactionCapability {
  snapshot(options: MemoryCompactionSnapshotOptions): Promise<MemoryCompactionSnapshot>;
  replacePrefix(
    options: MemoryCompactionReplacePrefixOptions,
  ): Promise<MemoryCompactionReplacePrefixResult>;
}

export type MemoryCompactorInput = {
  scope: MemoryScope;
  messages: Message[];
  abortSignal?: AbortSignal | undefined;
};

export type MemoryCompactorResult = {
  summary: string;
  usage?: Usage | undefined;
};

export type MemoryCompactor = (input: MemoryCompactorInput) => Promise<MemoryCompactorResult>;

/** Counts the approximate or exact model tokens represented by a message list. */
export type MemoryTokenCounter = (messages: readonly Message[]) => number | Promise<number>;

export type CreateSummaryMemoryCompactorOptions = {
  model: CompletionModel;
  instructions?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
};

export type MemoryCompactionConflictRetryOptions = {
  maxAttempts: number;
};

export type MemoryCompactionOptions = {
  trigger: {
    afterTokens: number;
  };
  retention?: {
    recentTokens?: number | undefined;
  };
  tokenCounter?: MemoryTokenCounter | undefined;
  compactor: MemoryCompactor;
  conflictRetries?: false | MemoryCompactionConflictRetryOptions | undefined;
};

export type MemoryOptions = {
  savePolicy?: MemorySavePolicy | undefined;
  compaction?: MemoryCompactionOptions | undefined;
};

export type MemoryCompactionInfo = {
  originalMessageCount: number;
  compactedMessageCount: number;
  retainedMessageCount: number;
  originalTokenCount: number;
  compactedTokenCount: number;
  retainedTokenCount: number;
  resultTokenCount: number;
  attempts: number;
  usage: Usage;
};

export type MemoryCompactionResult =
  | ({ type: "compacted" } & MemoryCompactionInfo)
  | {
      type: "skipped";
      reason: "nothing_to_compact";
      originalMessageCount: number;
      originalTokenCount: number;
    };
