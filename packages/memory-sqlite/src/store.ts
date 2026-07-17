import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { JsonObject, JsonValue, MemoryStore, Message } from "@anvia/core";
import type {
  MemoryAppendInput,
  MemoryContext,
  MemoryConversation,
  MemoryConversationListOptions,
  MemoryConversationSummary,
  MemoryErrorInput,
  MemoryInspector,
} from "@anvia/core/memory";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import type { SqliteMemoryScopeOptions, SqliteMemoryStoreOptions } from "./types.js";

type DatabaseSyncConstructor = typeof DatabaseSyncType;

let DatabaseSync: DatabaseSyncConstructor | undefined;

const defaultScopeOptions: { includeUserId: boolean; metadataKeys: string[] } = {
  includeUserId: true,
  metadataKeys: [],
};

type ResolvedSqliteMemoryStoreOptions = Required<
  Pick<SqliteMemoryStoreOptions, "createIfMissing" | "errors" | "validateMessages">
> &
  Pick<SqliteMemoryStoreOptions, "scope">;

type SessionIdRow = {
  id: string;
};

type PositionRow = {
  position: number | null;
};

type MessageRow = {
  message_json: string;
};

type InspectionSessionRow = {
  ref: string;
  session_id: string;
  user_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type InspectionMessageRow = {
  position: number;
  run_id: string;
  turn: number;
  created_at: string;
  message_json: string;
};

export function createSqliteMemoryStore(options: SqliteMemoryStoreOptions = {}): SqliteMemoryStore {
  return new SqliteMemoryStore(options.path ?? ":memory:", resolveOptions(options));
}

export function createSqliteMemoryScopeKey(
  context: MemoryContext,
  options: SqliteMemoryScopeOptions = {},
): string {
  const includeUserId = options.includeUserId ?? defaultScopeOptions.includeUserId;
  const metadataKeys = options.metadataKeys ?? defaultScopeOptions.metadataKeys;
  const values: JsonValue[] = [context.sessionId];

  if (includeUserId) {
    values.push(context.userId ?? null);
  }

  for (const key of metadataKeys) {
    values.push(metadataValue(context.metadata, key) ?? null);
  }

  return JSON.stringify(values);
}

export class SqliteMemoryStore implements MemoryStore {
  readonly kind = "sqlite";
  readonly inspector: MemoryInspector = {
    listConversations: (options) => this.listConversations(options),
    getConversation: (ref) => this.getConversation(ref),
  };
  private db: DatabaseSyncType | undefined;

  constructor(
    private readonly path: string,
    private readonly options: ResolvedSqliteMemoryStoreOptions,
  ) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const rows = this.database()
      .prepare(
        `SELECT m.message_json
         FROM anvia_memory_messages m
         INNER JOIN anvia_memory_sessions s ON s.id = m.memory_session_id
         WHERE s.scope_key = $scopeKey
         ORDER BY m.position ASC`,
      )
      .all({
        $scopeKey: this.scopeKey(context),
      }) as MessageRow[];

    return rows.map((row) => this.messageFromJson(row.message_json));
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    this.validateInputMessages(input.messages);

    const db = this.database();
    const scopeKey = this.scopeKey(input.context);

    try {
      db.exec("BEGIN IMMEDIATE");
      const sessionId = this.upsertSession(input.context, scopeKey);
      const last = db
        .prepare(
          `SELECT MAX(position) AS position
           FROM anvia_memory_messages
           WHERE memory_session_id = $memorySessionId`,
        )
        .get({ $memorySessionId: sessionId }) as PositionRow | undefined;
      const start = (last?.position ?? -1) + 1;
      const insertMessage = db.prepare(
        `INSERT INTO anvia_memory_messages (
          id,
          memory_session_id,
          run_id,
          turn,
          position,
          role,
          message_json,
          created_at
        ) VALUES (
          $id,
          $memorySessionId,
          $runId,
          $turn,
          $position,
          $role,
          $messageJson,
          $now
        )`,
      );
      const now = new Date().toISOString();

      input.messages.forEach((message, index) => {
        insertMessage.run({
          $id: randomUUID(),
          $memorySessionId: sessionId,
          $runId: input.runId,
          $turn: input.turn,
          $position: start + index,
          $role: message.role,
          $messageJson: JSON.stringify(message),
          $now: now,
        });
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async clear(context: MemoryContext): Promise<void> {
    this.database()
      .prepare("DELETE FROM anvia_memory_sessions WHERE scope_key = $scopeKey")
      .run({
        $scopeKey: this.scopeKey(context),
      });
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    if (this.options.errors === "ignore") {
      return;
    }
    this.validateInputMessages(input.messages);

    const db = this.database();
    const scopeKey = this.scopeKey(input.context);

    try {
      db.exec("BEGIN IMMEDIATE");
      const sessionId = this.upsertSession(input.context, scopeKey);
      db.prepare(
        `INSERT INTO anvia_memory_errors (
          id,
          memory_session_id,
          run_id,
          error_json,
          messages_json,
          created_at
        ) VALUES (
          $id,
          $memorySessionId,
          $runId,
          $errorJson,
          $messagesJson,
          $now
        )`,
      ).run({
        $id: randomUUID(),
        $memorySessionId: sessionId,
        $runId: input.runId,
        $errorJson: JSON.stringify(serializeUnknownError(input.error)),
        $messagesJson: JSON.stringify(input.messages),
        $now: new Date().toISOString(),
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private async listConversations(
    options: MemoryConversationListOptions,
  ): Promise<MemoryConversationSummary[]> {
    const where = options.userId === undefined ? "" : "WHERE s.user_id = $userId";
    const statement = this.database().prepare(
      `SELECT
         s.id AS ref,
         s.session_id,
         s.user_id,
         s.metadata_json,
         s.created_at,
         s.updated_at,
         COUNT(m.id) AS message_count
       FROM anvia_memory_sessions s
       LEFT JOIN anvia_memory_messages m ON m.memory_session_id = s.id
       ${where}
       GROUP BY s.id
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT $limit`,
    );
    const parameters: Record<string, string | number> = { $limit: options.limit };
    if (options.userId !== undefined) parameters.$userId = options.userId;
    const rows = statement.all(parameters) as InspectionSessionRow[];
    return rows.map((row) => this.inspectionSummary(row));
  }

  private async getConversation(ref: string): Promise<MemoryConversation | undefined> {
    const row = this.database()
      .prepare(
        `SELECT
           s.id AS ref,
           s.session_id,
           s.user_id,
           s.metadata_json,
           s.created_at,
           s.updated_at,
           COUNT(m.id) AS message_count
         FROM anvia_memory_sessions s
         LEFT JOIN anvia_memory_messages m ON m.memory_session_id = s.id
         WHERE s.id = $ref
         GROUP BY s.id`,
      )
      .get({ $ref: ref }) as InspectionSessionRow | undefined;
    if (row === undefined) return undefined;

    const messages = this.database()
      .prepare(
        `SELECT position, run_id, turn, created_at, message_json
         FROM anvia_memory_messages
         WHERE memory_session_id = $ref
         ORDER BY position ASC`,
      )
      .all({ $ref: ref }) as InspectionMessageRow[];

    return {
      ...this.inspectionSummary(row),
      messages: messages.map((message) => ({
        position: message.position,
        runId: message.run_id,
        turn: message.turn,
        createdAt: message.created_at,
        message: this.messageFromJson(message.message_json),
      })),
    };
  }

  private inspectionSummary(row: InspectionSessionRow): MemoryConversationSummary {
    const summary: MemoryConversationSummary = {
      ref: row.ref,
      sessionId: row.session_id,
      metadata: JSON.parse(row.metadata_json) as JsonObject,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count),
    };
    if (row.user_id !== null) summary.userId = row.user_id;
    return summary;
  }

  private database(): DatabaseSyncType {
    if (this.db !== undefined) {
      return this.db;
    }

    if (this.path !== ":memory:") {
      mkdirSync(dirname(resolve(this.path)), { recursive: true });
    }

    const SQLite = databaseSync();
    this.db = new SQLite(this.path);
    this.db.exec("PRAGMA foreign_keys = ON");

    if (this.options.createIfMissing) {
      this.db.exec(sqliteMemorySchemaSql);
    }

    return this.db;
  }

  private upsertSession(context: MemoryContext, scopeKey: string): string {
    const db = this.database();
    const existing = db
      .prepare("SELECT id FROM anvia_memory_sessions WHERE scope_key = $scopeKey")
      .get({ $scopeKey: scopeKey }) as SessionIdRow | undefined;
    const now = new Date().toISOString();

    if (existing !== undefined) {
      db.prepare(
        `UPDATE anvia_memory_sessions
         SET session_id = $sessionId,
             user_id = $userId,
             metadata_json = $metadataJson,
             updated_at = $now
         WHERE id = $id`,
      ).run({
        $id: existing.id,
        $sessionId: context.sessionId,
        $userId: context.userId ?? null,
        $metadataJson: JSON.stringify(metadata(context)),
        $now: now,
      });
      return existing.id;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO anvia_memory_sessions (
        id,
        scope_key,
        session_id,
        user_id,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        $id,
        $scopeKey,
        $sessionId,
        $userId,
        $metadataJson,
        $now,
        $now
      )`,
    ).run({
      $id: id,
      $scopeKey: scopeKey,
      $sessionId: context.sessionId,
      $userId: context.userId ?? null,
      $metadataJson: JSON.stringify(metadata(context)),
      $now: now,
    });
    return id;
  }

  private messageFromJson(raw: string): Message {
    const value = JSON.parse(raw) as unknown;
    return this.options.validateMessages ? parseMemoryMessage(value) : (value as Message);
  }

  private validateInputMessages(messages: Message[]): void {
    if (this.options.validateMessages) {
      for (const message of messages) {
        parseMemoryMessage(message);
      }
    }
  }

  private scopeKey(context: MemoryContext): string {
    if (typeof this.options.scope === "function") {
      return this.options.scope(context);
    }
    return createSqliteMemoryScopeKey(context, this.options.scope);
  }
}

const sqliteMemorySchemaSql = `
CREATE TABLE IF NOT EXISTS anvia_memory_sessions (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  user_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anvia_memory_messages (
  id TEXT PRIMARY KEY,
  memory_session_id TEXT NOT NULL REFERENCES anvia_memory_sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_session_id, position)
);

CREATE INDEX IF NOT EXISTS anvia_memory_messages_session_position_idx
  ON anvia_memory_messages(memory_session_id, position);

CREATE TABLE IF NOT EXISTS anvia_memory_errors (
  id TEXT PRIMARY KEY,
  memory_session_id TEXT NOT NULL REFERENCES anvia_memory_sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  error_json TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

function resolveOptions(options: SqliteMemoryStoreOptions): ResolvedSqliteMemoryStoreOptions {
  return {
    scope: options.scope,
    errors: options.errors ?? "store",
    validateMessages: options.validateMessages ?? true,
    createIfMissing: options.createIfMissing ?? true,
  };
}

function databaseSync(): DatabaseSyncConstructor {
  if (DatabaseSync !== undefined) {
    return DatabaseSync;
  }

  const require = createRequire(import.meta.url);
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };
    DatabaseSync = sqlite.DatabaseSync;
    return DatabaseSync;
  } catch (error) {
    throw new Error("@anvia/memory-sqlite requires a Node.js runtime with node:sqlite support.", {
      cause: error,
    });
  }
}

function metadata(context: MemoryContext): JsonObject {
  return context.metadata ?? {};
}

function metadataValue(metadata: JsonObject | undefined, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = metadata;
  for (const part of path.split(".")) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
