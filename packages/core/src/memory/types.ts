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
  /**
   * Stable key for this write. A store must commit a write under a key at most once: a repeat with
   * the same content is a `duplicate` and writes nothing, and a repeat with different content is a
   * `conflict`. Keys are scoped to the memory scope. Omit it for a plain append.
   */
  idempotencyKey?: string | undefined;
  /**
   * Version returned by `loadVersioned` that this write is based on. When the store's current
   * version differs, the write is rejected with `conflict` and nothing is written. Omit it to append
   * without a version check.
   */
  expectedVersion?: string | undefined;
};

/**
 * Outcome of an append. `committed`: the messages were written. `duplicate`: the idempotency key was
 * already committed with the same content, so nothing was written. `conflict`: the key was committed
 * with different content, or `expectedVersion` is stale, so nothing was written.
 */
export type MemoryAppendResult = {
  status: "committed" | "duplicate" | "conflict";
  /** The store version after this call. Stores that do not version their history may omit it. */
  version?: string | undefined;
};

/** The canonical history together with the version that a later write can be checked against. */
export type MemoryVersionedHistory = {
  messages: Message[];
  version: string;
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
  /**
   * Optional. Loads the same history as `load` together with its version, so a caller can pass the
   * version back as `expectedVersion` and detect a change made in between. Stores without versions
   * omit it; the runtime does not require it.
   */
  loadVersioned?(options: MemoryLoadOptions): Promise<MemoryVersionedHistory>;
  /**
   * Appends messages. Stores written before idempotency keys may return `void`, which means
   * `committed`. Stores that support `idempotencyKey` or `expectedVersion` return a
   * {@link MemoryAppendResult}.
   */
  append(options: MemoryAppendOptions): Promise<MemoryAppendResult | void>;
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
  /** Sent only when set, so models that reject `temperature` work by default. */
  temperature?: number | null | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
};

export type MemoryCompactionConflictRetryOptions = {
  maxAttempts: number;
};

export type MemoryCompactionRetention = {
  /** Completed tool rounds to retain within a run. Defaults to one; zero allows summarizing the latest result. */
  recentToolTurns?: number | undefined;
} & (
  | {
      /**
       * Number of complete, user-led turns to keep unsummarized. A `user` message starts a turn;
       * following assistant, tool, and system messages stay with it until the next user message.
       *
       * @default 1
       */
      recentTurns?: number | undefined;
      recentTokens?: never;
    }
  | {
      /**
       * Messages within this token budget of the end stay unsummarized.
       *
       * @deprecated Use `recentTurns`. Token retention remains available for compatibility.
       */
      recentTokens: number;
      recentTurns?: never;
    }
);

/** When and how session memory is compacted. */
export type MemoryCompactionOptions = {
  trigger: {
    /** Compaction runs when the projected context exceeds this token count. */
    afterTokens: number;
  };
  retention?: MemoryCompactionRetention | undefined;
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
