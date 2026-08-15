import type { JsonValue } from "@anvia/core";
import type { MemoryAppendOptions, MemoryErrorOptions, MemoryScope } from "@anvia/core/memory";

export type SqliteMemoryErrorMode = "store" | "ignore";

export type SqliteMemoryScopeOptions = {
  includeUserId?: boolean | undefined;
  metadataKeys?: string[] | undefined;
};

export type SqliteMemoryStoreOptions = {
  path?: string | undefined;
  scope?: SqliteMemoryScopeOptions | ((context: MemoryScope) => string) | undefined;
  errors?: SqliteMemoryErrorMode | undefined;
  validateMessages?: boolean | undefined;
  createIfMissing?: boolean | undefined;
};

export type SqliteMemorySessionRow = {
  id: string;
  scope_key: string;
  session_id: string;
  user_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type SqliteMemoryMessageRow = {
  message_json: string;
};

export type SqliteMemoryErrorRow = {
  id: string;
  memory_session_id: string;
  run_id: string;
  error_json: JsonValue;
  messages_json: JsonValue;
  created_at: string;
};

export type SqliteMemoryAppendOptions = MemoryAppendOptions;
export type SqliteMemoryScope = MemoryScope;
export type SqliteMemoryErrorOptions = MemoryErrorOptions;
