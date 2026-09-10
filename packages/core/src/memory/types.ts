import type {
  CompletionModel,
  JsonObject,
  Message,
  SystemMessage,
  Usage,
} from "../completion/types";
import type { RetrySetting } from "../retry";

/**
 * Granularity at which produced messages are persisted:
 *
 * - `message`: after each individual message
 * - `turn`: after each agent turn completes
 * - `run`: once when the run finishes
 */
export type MemorySavePolicy = "message" | "turn" | "run";

/** Identifies a conversation within a memory store. */
export type MemoryScope = {
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};

/** Options controlling how a memory scope is reduced to a storage key. */
export type MemoryScopeKeyOptions = {
  /** Includes `scope.userId` in the derived key. */
  includeUserId?: boolean | undefined;
  /** Metadata entries (by key) included in the derived key. */
  metadataKeys?: readonly string[] | undefined;
};

export type CreateMemoryScopeKeyOptions = MemoryScopeKeyOptions & {
  scope: MemoryScope;
};

/** Either key-derivation options or a custom resolver function. */
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

/** Persisted summary of a stored conversation. */
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

/** One stored message with its position and originating run/turn. */
export type MemoryConversationMessage = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string;
  message: Message;
};

/** A full stored conversation: summary plus replayable messages. */
export type MemoryConversation = MemoryConversationSummary & {
  messages: MemoryConversationMessage[];
};

/** Optional, read-only discovery surface for developer tooling such as Studio. */
export interface MemoryInspector {
  listConversations(options: MemoryConversationListOptions): Promise<MemoryConversationSummary[]>;
  getConversation(options: MemoryConversationGetOptions): Promise<MemoryConversation | undefined>;
}

/**
 * Append-only conversation storage. The runtime loads history at run start,
 * appends produced messages per the configured {@link MemorySavePolicy}, and
 * clears on demand. `load` must return the canonical, replayable history.
 */
export interface MemoryStore {
  readonly inspector?: MemoryInspector | undefined;
  readonly compaction?: MemoryCompactionCapability | undefined;
  /** Loads the canonical, replayable conversation history. */
  load(options: MemoryLoadOptions): Promise<Message[]>;
  append(options: MemoryAppendOptions): Promise<void>;
  clear(options: MemoryClearOptions): Promise<void>;
  /** Records a failed run for debugging; unsupported stores may omit it. */
  recordError?(options: MemoryErrorOptions): Promise<void>;
}

/** Metadata embedded in a compaction summary message. */
export type MemoryCompactionMetadata = {
  /** Schema version of the compaction marker. */
  version: 1;
  compactedMessageCount: number;
};

/** A system message that stores a summary checkpoint in the conversation history. */
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
  /** Current model-context projection: the latest summary checkpoint plus unsummarized messages. */
  messages: Message[];
};

export type MemoryCompactionSnapshotOptions = {
  scope: MemoryScope;
};

export type MemoryCompactionReplacePrefixOptions = {
  scope: MemoryScope;
  revision: string;
  /** Number of projected messages covered by `replacement`, including any prior summary message. */
  messageCount: number;
  replacement: MemoryCompactionMessage;
  runId: string;
};

/** Result of a prefix replacement: `conflict` means the revision was stale and the replacement was rejected. */
export type MemoryCompactionReplacePrefixResult = {
  status: "committed" | "conflict";
};

/**
 * Optional atomic context-projection capability used by memory compaction.
 *
 * Implementations must preserve canonical messages. `snapshot()` returns the current model-context
 * projection, while `replacePrefix()` replaces only that projection's prefix with a summary.
 */
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

/** Summarizes a list of messages into a compact replacement. */
export type MemoryCompactor = (input: MemoryCompactorInput) => Promise<MemoryCompactorResult>;

/** Counts the approximate or exact model tokens represented by a message list. */
export type MemoryTokenCounter = (messages: readonly Message[]) => number | Promise<number>;

/** Options for the built-in, model-backed summary compactor. */
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

/** When and how session memory is compacted. */
export type MemoryCompactionOptions = {
  trigger: {
    /** Compaction runs when the projected context exceeds this token count. */
    afterTokens: number;
  };
  retention?: {
    /** Messages within this token budget of the end stay unsummarized. */
    recentTokens?: number | undefined;
  };
  /** Overrides the default approximate counter; use a model counter for exact budgets. */
  tokenCounter?: MemoryTokenCounter | undefined;
  compactor: MemoryCompactor;
  /** `false` disables retrying when a store reports a revision conflict. */
  conflictRetries?: false | MemoryCompactionConflictRetryOptions | undefined;
};

/** Memory settings for an agent. */
export type MemoryOptions = {
  /** @default "message" */
  savePolicy?: MemorySavePolicy | undefined;
  compaction?: MemoryCompactionOptions | undefined;
};

/** Measurements recorded for one compaction attempt. */
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

/** Outcome of a compaction attempt: performed, or skipped because there was nothing to compact. */
export type MemoryCompactionResult =
  | ({ type: "compacted" } & MemoryCompactionInfo)
  | {
      type: "skipped";
      reason: "nothing_to_compact";
      originalMessageCount: number;
      originalTokenCount: number;
    };
