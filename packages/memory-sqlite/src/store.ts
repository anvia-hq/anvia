import { randomUUID } from "node:crypto";
import type { JsonObject, MemoryCompactionMessage, MemoryStore, Message } from "@anvia/core";
import type {
  MemoryAppendOptions,
  MemoryCompactionCapability,
  MemoryCompactionReplacePrefixOptions,
  MemoryCompactionReplacePrefixResult,
  MemoryCompactionSnapshot,
  MemoryConversation,
  MemoryConversationListOptions,
  MemoryConversationSummary,
  MemoryErrorOptions,
  MemoryInspector,
  MemoryScope,
} from "@anvia/core/memory";
import { createMemoryScopeKey, isMemoryCompactionMessage } from "@anvia/core/memory";
import { type SqliteMemoryClient, sqliteMemoryExistingClient } from "./client.js";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import type {
  SqliteMemoryDatabaseLike,
  SqliteMemorySchemaOptions,
  SqliteMemoryStoreOptions,
} from "./types.js";

type ResolvedSqliteMemoryStoreOptions = Required<
  Pick<SqliteMemoryStoreOptions, "errorPolicy" | "validateMessages">
> &
  Pick<SqliteMemoryStoreOptions, "scopeKey">;

type ResolvedSqliteMemoryTables = {
  sessions: string;
  messages: string;
  errors: string;
  messagesPositionIndex: string;
  messagesPositionIndexName: string;
};

type SqliteIndexRow = {
  name: string;
  unique: number;
};

type SqliteIndexColumnRow = {
  seqno: number;
  name: string;
};

type SqliteForeignKeysRow = {
  foreign_keys: number;
};

type SessionIdRow = {
  id: string;
};

type CompactionSessionRow = SessionIdRow & {
  compaction_state_json: string | null;
};

type StoredCompactionState = {
  version: 1;
  generation: number;
  summary: MemoryCompactionMessage;
  summarizedThroughPosition: number;
};

type PositionRow = {
  position: number | null;
};

type MessageRow = {
  message_json: string;
};

type CompactionMessageRow = {
  id: string;
  position: number;
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

export const sqliteMemoryStoreFactory = Symbol("SqliteMemoryStore.factory");

export class SqliteMemoryStore implements MemoryStore {
  readonly kind = "sqlite";
  readonly inspector: MemoryInspector = {
    listConversations: (options) => this.listConversations(options),
    getConversation: ({ ref }) => this.getConversation(ref),
  };
  readonly compaction: MemoryCompactionCapability = {
    snapshot: ({ scope }) => this.loadCompactionSnapshot(scope),
    replacePrefix: (options) => this.replaceCompactionPrefix(options),
  };
  private readonly tables: ResolvedSqliteMemoryTables;
  private readonly options: ResolvedSqliteMemoryStoreOptions;

  private constructor(input: { owner: SqliteMemoryClient; options: SqliteMemoryStoreOptions }) {
    this.owner = input.owner;
    this.tables = resolveTables(input.options);
    this.options = resolveOptions(input.options);
  }

  private readonly owner: SqliteMemoryClient;

  static [sqliteMemoryStoreFactory](input: {
    owner: SqliteMemoryClient;
    options: SqliteMemoryStoreOptions;
  }): SqliteMemoryStore {
    return new SqliteMemoryStore(input);
  }

  async ensure(): Promise<void> {
    const database = await this.owner.nativeClient();
    database.exec(sqliteMemorySchemaSql(this.tables));
    ensureCompactionStateColumn(database, this.tables.sessions);
    await this.validateDatabase(database);
  }

  async validate(): Promise<void> {
    await this.validateDatabase(await this.database());
  }

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    const rows = (await this.database())
      .prepare(
        `SELECT m.message_json
         FROM ${this.tables.messages} m
         INNER JOIN ${this.tables.sessions} s ON s.id = m.memory_session_id
         WHERE s.scope_key = $scopeKey
         ORDER BY m.position ASC`,
      )
      .all({
        $scopeKey: this.scopeKey(scope),
      }) as MessageRow[];

    return rows.map((row) => this.messageFromJson(row.message_json));
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    this.validateInputMessages(input.messages);

    const db = await this.database();
    const scopeKey = this.scopeKey(input.scope);

    try {
      db.exec("BEGIN IMMEDIATE");
      const sessionId = this.upsertSession(db, input.scope, scopeKey);
      const last = db
        .prepare(
          `SELECT MAX(position) AS position
           FROM ${this.tables.messages}
           WHERE memory_session_id = $memorySessionId`,
        )
        .get({ $memorySessionId: sessionId }) as PositionRow | undefined;
      const start = (last?.position ?? -1) + 1;
      const insertMessage = db.prepare(
        `INSERT INTO ${this.tables.messages} (
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

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    (await this.database())
      .prepare(`DELETE FROM ${this.tables.sessions} WHERE scope_key = $scopeKey`)
      .run({
        $scopeKey: this.scopeKey(scope),
      });
  }

  async recordError(input: MemoryErrorOptions): Promise<void> {
    if (this.options.errorPolicy === "ignore") {
      return;
    }
    this.validateInputMessages(input.messages);

    const db = await this.database();
    const scopeKey = this.scopeKey(input.scope);

    try {
      db.exec("BEGIN IMMEDIATE");
      const sessionId = this.upsertSession(db, input.scope, scopeKey);
      db.prepare(
        `INSERT INTO ${this.tables.errors} (
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

  private async loadCompactionSnapshot(context: MemoryScope): Promise<MemoryCompactionSnapshot> {
    const database = await this.database();
    const session = database
      .prepare(
        `SELECT id, compaction_state_json
         FROM ${this.tables.sessions}
         WHERE scope_key = $scopeKey`,
      )
      .get({ $scopeKey: this.scopeKey(context) }) as CompactionSessionRow | undefined;
    if (session === undefined) {
      return { revision: compactionRevision([], undefined), messages: [] };
    }
    const state = this.compactionStateFromJson(session.compaction_state_json);
    const rows = this.compactionRows(database, session.id, state);
    return {
      revision: compactionRevision(rows, state),
      messages: projectedMessages(rows, state, (row) => this.messageFromJson(row.message_json)),
    };
  }

  private async replaceCompactionPrefix(
    input: MemoryCompactionReplacePrefixOptions,
  ): Promise<MemoryCompactionReplacePrefixResult> {
    this.validateInputMessages([input.replacement]);
    assertCompactionMessageCount(input.messageCount);
    const db = await this.database();
    const scopeKey = this.scopeKey(input.scope);

    try {
      db.exec("BEGIN IMMEDIATE");
      const session = db
        .prepare(
          `SELECT id, compaction_state_json
           FROM ${this.tables.sessions}
           WHERE scope_key = $scopeKey`,
        )
        .get({ $scopeKey: scopeKey }) as CompactionSessionRow | undefined;
      if (session === undefined) {
        db.exec("ROLLBACK");
        return { status: "conflict" };
      }
      const state = this.compactionStateFromJson(session.compaction_state_json);
      const rows = this.compactionRows(db, session.id, state);
      const activeRows = activeCompactionRows(rows, state);
      const physicalPrefixCount = input.messageCount - (state === undefined ? 0 : 1);
      if (
        compactionRevision(rows, state) !== input.revision ||
        physicalPrefixCount < 0 ||
        physicalPrefixCount > activeRows.length
      ) {
        db.exec("ROLLBACK");
        return { status: "conflict" };
      }
      const summarizedThroughPosition =
        physicalPrefixCount === 0
          ? state?.summarizedThroughPosition
          : activeRows[physicalPrefixCount - 1]?.position;
      if (summarizedThroughPosition === undefined) {
        db.exec("ROLLBACK");
        return { status: "conflict" };
      }
      const nextState: StoredCompactionState = {
        version: 1,
        generation: (state?.generation ?? 0) + 1,
        summary: input.replacement,
        summarizedThroughPosition,
      };
      db.prepare(
        `UPDATE ${this.tables.sessions}
         SET compaction_state_json = $compactionStateJson,
             updated_at = $now
         WHERE id = $id`,
      ).run({
        $id: session.id,
        $compactionStateJson: JSON.stringify(nextState),
        $now: new Date().toISOString(),
      });
      db.exec("COMMIT");
      return { status: "committed" };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private async listConversations(
    options: MemoryConversationListOptions,
  ): Promise<MemoryConversationSummary[]> {
    const where = options.userId === undefined ? "" : "WHERE s.user_id = $userId";
    const statement = (await this.database()).prepare(
      `SELECT
         s.id AS ref,
         s.session_id,
         s.user_id,
         s.metadata_json,
         s.created_at,
         s.updated_at,
         COUNT(m.id) AS message_count
       FROM ${this.tables.sessions} s
       LEFT JOIN ${this.tables.messages} m ON m.memory_session_id = s.id
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
    const database = await this.database();
    const row = database
      .prepare(
        `SELECT
           s.id AS ref,
           s.session_id,
           s.user_id,
           s.metadata_json,
           s.created_at,
           s.updated_at,
           COUNT(m.id) AS message_count
         FROM ${this.tables.sessions} s
         LEFT JOIN ${this.tables.messages} m ON m.memory_session_id = s.id
         WHERE s.id = $ref
         GROUP BY s.id`,
      )
      .get({ $ref: ref }) as InspectionSessionRow | undefined;
    if (row === undefined) return undefined;

    const messages = database
      .prepare(
        `SELECT position, run_id, turn, created_at, message_json
         FROM ${this.tables.messages}
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

  private database(): Promise<SqliteMemoryDatabaseLike> {
    return this.owner[sqliteMemoryExistingClient]();
  }

  private upsertSession(
    db: SqliteMemoryDatabaseLike,
    context: MemoryScope,
    scopeKey: string,
  ): string {
    const existing = db
      .prepare(`SELECT id FROM ${this.tables.sessions} WHERE scope_key = $scopeKey`)
      .get({ $scopeKey: scopeKey }) as SessionIdRow | undefined;
    const now = new Date().toISOString();

    if (existing !== undefined) {
      db.prepare(
        `UPDATE ${this.tables.sessions}
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
      `INSERT INTO ${this.tables.sessions} (
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

  private compactionStateFromJson(raw: string | null): StoredCompactionState | undefined {
    if (raw === null) return undefined;
    return parseCompactionState(JSON.parse(raw) as unknown, (message) =>
      this.options.validateMessages ? parseMemoryMessage(message) : (message as Message),
    );
  }

  private compactionRows(
    database: SqliteMemoryDatabaseLike,
    sessionId: string,
    state: StoredCompactionState | undefined,
  ): CompactionMessageRow[] {
    const boundaryClause = state === undefined ? "" : "AND position >= $boundary";
    const statement = database.prepare(
      `SELECT id, position, message_json
       FROM ${this.tables.messages}
       WHERE memory_session_id = $memorySessionId
         ${boundaryClause}
       ORDER BY position ASC`,
    );
    return statement.all(
      state === undefined
        ? { $memorySessionId: sessionId }
        : { $memorySessionId: sessionId, $boundary: state.summarizedThroughPosition },
    ) as CompactionMessageRow[];
  }

  private validateInputMessages(messages: Message[]): void {
    if (this.options.validateMessages) {
      for (const message of messages) {
        parseMemoryMessage(message);
      }
    }
  }

  private scopeKey(context: MemoryScope): string {
    if (typeof this.options.scopeKey === "function") {
      return this.options.scopeKey({ scope: context });
    }
    return createMemoryScopeKey({ scope: context, ...this.options.scopeKey });
  }

  private async validateDatabase(database: SqliteMemoryDatabaseLike): Promise<void> {
    const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as
      | SqliteForeignKeysRow
      | undefined;
    if (foreignKeys?.foreign_keys !== 1) {
      throw new Error(
        "Sqlite memory requires foreign-key enforcement. Enable foreign keys on the injected database.",
      );
    }

    database
      .prepare(
        `SELECT
           s.id, s.scope_key, s.session_id, s.user_id, s.metadata_json,
           s.compaction_state_json, s.created_at, s.updated_at,
           m.id, m.memory_session_id, m.run_id, m.turn, m.position, m.role, m.message_json, m.created_at
         FROM ${this.tables.sessions} s
         LEFT JOIN ${this.tables.messages} m ON m.memory_session_id = s.id
         LIMIT 0`,
      )
      .all();
    database
      .prepare(
        `SELECT id, memory_session_id, run_id, error_json, messages_json, created_at
         FROM ${this.tables.errors}
         LIMIT 0`,
      )
      .all();

    const messageIndexes = database
      .prepare(`PRAGMA index_list(${this.tables.messages})`)
      .all() as unknown as SqliteIndexRow[];
    const hasUniquePositionIndex = messageIndexes
      .filter((index) => index.unique === 1)
      .some((index) => {
        const columns = database
          .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
          .all() as unknown as SqliteIndexColumnRow[];
        return (
          columns
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name)
            .join(",") === "memory_session_id,position"
        );
      });
    if (!hasUniquePositionIndex) {
      throw new Error("Sqlite memory messages table requires a unique position index.");
    }

    const namedIndex = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = $name")
      .get({ $name: this.tables.messagesPositionIndexName });
    if (namedIndex === undefined) {
      throw new Error(
        `Sqlite memory messages position index is missing: ${this.tables.messagesPositionIndexName}`,
      );
    }
  }
}

export function createSqliteMemorySchemaSql(options: SqliteMemorySchemaOptions = {}): string {
  return sqliteMemorySchemaSql(resolveTables(options));
}

function sqliteMemorySchemaSql(tables: ResolvedSqliteMemoryTables): string {
  return `CREATE TABLE IF NOT EXISTS ${tables.sessions} (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  user_id TEXT,
  metadata_json TEXT NOT NULL,
  compaction_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${tables.messages} (
  id TEXT PRIMARY KEY,
  memory_session_id TEXT NOT NULL REFERENCES ${tables.sessions}(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_session_id, position)
);

CREATE INDEX IF NOT EXISTS ${tables.messagesPositionIndex}
  ON ${tables.messages}(memory_session_id, position);

CREATE TABLE IF NOT EXISTS ${tables.errors} (
  id TEXT PRIMARY KEY,
  memory_session_id TEXT NOT NULL REFERENCES ${tables.sessions}(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  error_json TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
}

function resolveOptions(options: SqliteMemoryStoreOptions): ResolvedSqliteMemoryStoreOptions {
  return {
    scopeKey: options.scopeKey,
    errorPolicy: options.errorPolicy ?? "store",
    validateMessages: options.validateMessages ?? true,
  };
}

function resolveTables(options: SqliteMemorySchemaOptions): ResolvedSqliteMemoryTables {
  const prefix = options.tablePrefix ?? "anvia_";
  const messagesPositionIndexName =
    options.tableNames?.messagesPositionIndex ?? `${prefix}memory_messages_session_position_idx`;
  return {
    sessions: quoteIdentifier(options.tableNames?.sessions ?? `${prefix}memory_sessions`),
    messages: quoteIdentifier(options.tableNames?.messages ?? `${prefix}memory_messages`),
    errors: quoteIdentifier(options.tableNames?.errors ?? `${prefix}memory_errors`),
    messagesPositionIndex: quoteIdentifier(messagesPositionIndexName),
    messagesPositionIndexName,
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function compactionRevision(
  rows: CompactionMessageRow[],
  state: StoredCompactionState | undefined,
): string {
  return JSON.stringify([state?.generation ?? 0, rows.map((row) => row.id)]);
}

function projectedMessages(
  rows: CompactionMessageRow[],
  state: StoredCompactionState | undefined,
  message: (row: CompactionMessageRow) => Message,
): Message[] {
  if (state === undefined) return rows.map(message);
  return [state.summary, ...activeCompactionRows(rows, state).map(message)];
}

function activeCompactionRows(
  rows: CompactionMessageRow[],
  state: StoredCompactionState | undefined,
): CompactionMessageRow[] {
  if (state === undefined) return rows;
  const boundaryIndex = rows.findIndex((row) => row.position === state.summarizedThroughPosition);
  if (boundaryIndex === -1) {
    throw new Error("Sqlite memory compaction state boundary is invalid.");
  }
  return rows.slice(boundaryIndex + 1);
}

function parseCompactionState(
  value: unknown,
  parseMessage: (message: unknown) => Message,
): StoredCompactionState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Sqlite memory compaction state must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !Number.isSafeInteger(record.summarizedThroughPosition) ||
    (record.summarizedThroughPosition as number) < 0
  ) {
    throw new Error("Sqlite memory compaction state is invalid.");
  }
  const summary = parseMessage(record.summary);
  if (!isMemoryCompactionMessage(summary)) {
    throw new Error("Sqlite memory compaction state summary is invalid.");
  }
  return {
    version: 1,
    generation: record.generation as number,
    summarizedThroughPosition: record.summarizedThroughPosition as number,
    summary: summary as MemoryCompactionMessage,
  };
}

function ensureCompactionStateColumn(
  database: SqliteMemoryDatabaseLike,
  sessionsTable: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${sessionsTable})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "compaction_state_json")) {
    database.exec(`ALTER TABLE ${sessionsTable} ADD COLUMN compaction_state_json TEXT`);
  }
}

function assertCompactionMessageCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("messageCount must be a positive integer.");
  }
}

function metadata(context: MemoryScope): JsonObject {
  return context.metadata ?? {};
}
