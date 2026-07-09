import type { JsonObject, JsonValue, MemoryStore, Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import type {
  PostgresMemoryClientLike,
  PostgresMemoryPoolLike,
  PostgresMemorySchemaOptions,
  PostgresMemoryScopeOptions,
  PostgresMemoryStoreOptions,
  PostgresMemoryTransactionClientLike,
} from "./types.js";

const defaultScopeOptions: { includeUserId: boolean; metadataKeys: string[] } = {
  includeUserId: true,
  metadataKeys: [],
};

type ResolvedPostgresMemoryStoreOptions = Required<
  Pick<PostgresMemoryStoreOptions, "createIfMissing" | "errors" | "lock" | "validateMessages">
> &
  Pick<PostgresMemoryStoreOptions, "scope">;

type ResolvedPostgresMemoryTables = {
  sessions: string;
  messages: string;
  errors: string;
  messagesPositionIndex: string;
};

type SessionRow = {
  id: string;
};

type PositionRow = {
  position: number | string | null;
};

type MessageRow = {
  message: unknown;
};

export async function createPostgresMemoryStore(
  options: PostgresMemoryStoreOptions = {},
): Promise<PostgresMemoryStore> {
  return PostgresMemoryStore.connect(options);
}

export function createPostgresMemoryScopeKey(
  context: MemoryContext,
  options: PostgresMemoryScopeOptions = {},
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

export function createPostgresMemorySchemaSql(options: PostgresMemorySchemaOptions = {}): string {
  const tables = resolveTables(options);
  return `CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ${tables.sessions} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE,
  session_id text NOT NULL,
  user_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${tables.messages} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_session_id uuid NOT NULL REFERENCES ${tables.sessions}(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  turn integer NOT NULL,
  position integer NOT NULL,
  role text NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ${tables.messagesPositionIndex}
  ON ${tables.messages}(memory_session_id, position);

CREATE TABLE IF NOT EXISTS ${tables.errors} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_session_id uuid NOT NULL REFERENCES ${tables.sessions}(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  error jsonb NOT NULL,
  messages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`;
}

export class PostgresMemoryStore implements MemoryStore {
  readonly kind = "postgres";

  private constructor(
    private readonly client: PostgresMemoryClientLike,
    private readonly tables: ResolvedPostgresMemoryTables,
    private readonly options: ResolvedPostgresMemoryStoreOptions,
  ) {}

  static async connect(options: PostgresMemoryStoreOptions = {}): Promise<PostgresMemoryStore> {
    const client = options.client ?? (await defaultPgClient(options.connectionString));
    const tables = resolveTables(options);
    const resolved = resolveOptions(options);

    if (resolved.createIfMissing) {
      await client.query(createPostgresMemorySchemaSql(options));
    }

    return new PostgresMemoryStore(client, tables, resolved);
  }

  async load(context: MemoryContext): Promise<Message[]> {
    const result = await this.client.query(
      `SELECT m.message
       FROM ${this.tables.messages} m
       INNER JOIN ${this.tables.sessions} s ON s.id = m.memory_session_id
       WHERE s.scope_key = $1
       ORDER BY m.position ASC`,
      [this.scopeKey(context)],
    );

    return result.rows.map((row) => this.messageFromValue((row as MessageRow).message));
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    const scopeKey = this.scopeKey(input.context);

    await this.transaction(async (tx) => {
      if (this.options.lock === "advisory") {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scopeKey]);
      }

      const session = await this.upsertSession(tx, input.context, scopeKey);
      const last = await tx.query(
        `SELECT position
         FROM ${this.tables.messages}
         WHERE memory_session_id = $1
         ORDER BY position DESC
         LIMIT 1`,
        [session.id],
      );
      const start = Number(((last.rows[0] as PositionRow | undefined)?.position ?? -1) as number);
      await this.insertMessages(tx, session.id, input, start + 1);
    });
  }

  async clear(context: MemoryContext): Promise<void> {
    await this.client.query(`DELETE FROM ${this.tables.sessions} WHERE scope_key = $1`, [
      this.scopeKey(context),
    ]);
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    if (this.options.errors === "ignore") {
      return;
    }

    const scopeKey = this.scopeKey(input.context);

    await this.transaction(async (tx) => {
      if (this.options.lock === "advisory") {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scopeKey]);
      }

      const session = await this.upsertSession(tx, input.context, scopeKey);
      await tx.query(
        `INSERT INTO ${this.tables.errors} (
          memory_session_id,
          run_id,
          error,
          messages
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [
          session.id,
          input.runId,
          JSON.stringify(serializeUnknownError(input.error)),
          JSON.stringify(input.messages),
        ],
      );
    });
  }

  private async transaction<T>(
    operation: (tx: PostgresMemoryClientLike) => Promise<T>,
  ): Promise<T> {
    const tx = await transactionClient(this.client);
    try {
      await tx.query("BEGIN");
      const result = await operation(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      if (isTransactionClient(tx)) {
        tx.release();
      }
    }
  }

  private async upsertSession(
    client: PostgresMemoryClientLike,
    context: MemoryContext,
    scopeKey: string,
  ): Promise<SessionRow> {
    const result = await client.query(
      `INSERT INTO ${this.tables.sessions} (
        scope_key,
        session_id,
        user_id,
        metadata
      ) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (scope_key) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        user_id = EXCLUDED.user_id,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id`,
      [scopeKey, context.sessionId, context.userId ?? null, JSON.stringify(metadata(context))],
    );
    const session = result.rows[0] as SessionRow | undefined;
    if (session === undefined) {
      throw new Error("PostgresMemoryStore failed to upsert memory session.");
    }
    return session;
  }

  private async insertMessages(
    client: PostgresMemoryClientLike,
    memorySessionId: string,
    input: MemoryAppendInput,
    start: number,
  ): Promise<void> {
    const values = input.messages.flatMap((message, index) => [
      memorySessionId,
      input.runId,
      input.turn,
      start + index,
      message.role,
      JSON.stringify(message),
    ]);
    const placeholders = input.messages.map((_, index) => {
      const offset = index * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${
        offset + 5
      }, $${offset + 6}::jsonb)`;
    });

    await client.query(
      `INSERT INTO ${this.tables.messages} (
        memory_session_id,
        run_id,
        turn,
        position,
        role,
        message
      ) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  private messageFromValue(value: unknown): Message {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return this.options.validateMessages ? parseMemoryMessage(parsed) : (parsed as Message);
  }

  private scopeKey(context: MemoryContext): string {
    if (typeof this.options.scope === "function") {
      return this.options.scope(context);
    }
    return createPostgresMemoryScopeKey(context, this.options.scope);
  }
}

function resolveOptions(options: PostgresMemoryStoreOptions): ResolvedPostgresMemoryStoreOptions {
  return {
    scope: options.scope,
    errors: options.errors ?? "store",
    validateMessages: options.validateMessages ?? true,
    createIfMissing: options.createIfMissing ?? true,
    lock: options.lock ?? "advisory",
  };
}

function resolveTables(options: PostgresMemorySchemaOptions): ResolvedPostgresMemoryTables {
  const prefix = options.tablePrefix ?? "anvia_";
  return {
    sessions: quoteQualifiedIdentifier(options.tableNames?.sessions ?? `${prefix}memory_sessions`),
    messages: quoteQualifiedIdentifier(options.tableNames?.messages ?? `${prefix}memory_messages`),
    errors: quoteQualifiedIdentifier(options.tableNames?.errors ?? `${prefix}memory_errors`),
    messagesPositionIndex: quoteIdentifier(`${prefix}memory_messages_session_position_idx`),
  };
}

function quoteQualifiedIdentifier(identifier: string): string {
  const parts = identifier.split(".");
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return parts.map(quoteIdentifier).join(".");
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function transactionClient(
  client: PostgresMemoryClientLike,
): Promise<PostgresMemoryClientLike | PostgresMemoryTransactionClientLike> {
  if (isPool(client)) {
    return client.connect();
  }
  return client;
}

function isPool(client: PostgresMemoryClientLike): client is PostgresMemoryPoolLike {
  return "connect" in client && typeof client.connect === "function";
}

function isTransactionClient(
  client: PostgresMemoryClientLike,
): client is PostgresMemoryTransactionClientLike {
  return "release" in client && typeof client.release === "function";
}

async function defaultPgClient(
  connectionString: string | undefined,
): Promise<PostgresMemoryPoolLike> {
  const pg = await import("pg");
  return new pg.Pool(connectionString === undefined ? {} : { connectionString });
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
