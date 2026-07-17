import type { JsonObject, Message } from "../completion/types";

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
  load(context: MemoryContext): Promise<Message[]>;
  append(input: MemoryAppendInput): Promise<void>;
  clear(context: MemoryContext): Promise<void>;
  recordError?(input: MemoryErrorInput): Promise<void>;
}

export type MemoryOptions = {
  savePolicy?: MemorySavePolicy | undefined;
};

export type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
};

export type MemoryRegistration = {
  store: MemoryStore;
  options: ResolvedMemoryOptions;
};

export type SessionOptions = {
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};
