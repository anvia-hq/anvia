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

export interface MemoryStore {
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
