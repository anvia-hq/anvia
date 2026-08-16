import type { JsonObject, MemoryStore, Message } from "@anvia/core";
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
import { createMemoryScopeKey } from "@anvia/core/memory";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import { drizzleMemorySchema } from "./schema.js";
import type {
  DrizzleMemoryDatabaseLike,
  DrizzleMemorySchema,
  DrizzleMemoryStoreOptions,
} from "./types.js";

type ResolvedDrizzleMemoryStoreOptions = Required<
  Pick<DrizzleMemoryStoreOptions, "errorPolicy" | "lock" | "validateMessages">
> &
  Pick<DrizzleMemoryStoreOptions, "scopeKey">;

type DrizzleRuntimeDatabase = {
  select(selection?: unknown): DrizzleSelectBuilder;
  insert(table: unknown): DrizzleInsertBuilder;
  delete(table: unknown): DrizzleDeleteBuilder;
  transaction?<T>(operation: (tx: DrizzleRuntimeDatabase) => Promise<T>): Promise<T>;
  execute?(query: unknown): Promise<unknown>;
};

type DrizzleSelectBuilder = PromiseLike<unknown[]> & {
  from(table: unknown): DrizzleSelectBuilder;
  innerJoin(table: unknown, condition: unknown): DrizzleSelectBuilder;
  leftJoin(table: unknown, condition: unknown): DrizzleSelectBuilder;
  where(condition: unknown): DrizzleSelectBuilder;
  groupBy(...columns: unknown[]): DrizzleSelectBuilder;
  orderBy(...columns: unknown[]): DrizzleSelectBuilder;
  limit(limit: number): DrizzleSelectBuilder;
};

type DrizzleInsertBuilder = PromiseLike<unknown[]> & {
  values(value: unknown): DrizzleInsertBuilder;
  onConflictDoUpdate(config: unknown): DrizzleInsertBuilder;
  returning(selection?: unknown): Promise<unknown[]>;
};

type DrizzleDeleteBuilder = {
  where(condition: unknown): Promise<unknown[]>;
};

type SessionRow = {
  id: string;
};

type PositionRow = {
  position: number | null;
};

type MessageRow = {
  message: unknown;
};

type CompactionMessageRow = {
  id: string;
  position: number;
  message: unknown;
};

type InspectionSessionRow = {
  ref: string;
  sessionId: string;
  userId: string | null;
  metadata: JsonObject;
  createdAt: string | Date;
  updatedAt: string | Date;
  messageCount: number | string;
};

type InspectionMessageRow = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string | Date;
  message: unknown;
};

export class DrizzleMemoryStore implements MemoryStore {
  readonly kind = "drizzle";
  readonly inspector: MemoryInspector = {
    listConversations: (options) => this.listConversations(options),
    getConversation: ({ ref }) => this.getConversation(ref),
  };
  readonly compaction: MemoryCompactionCapability = {
    snapshot: ({ scope }) => this.loadCompactionSnapshot(scope),
    replacePrefix: (options) => this.replaceCompactionPrefix(options),
  };

  private readonly db: DrizzleMemoryDatabaseLike;
  private readonly schema: DrizzleMemorySchema;
  private readonly options: ResolvedDrizzleMemoryStoreOptions;

  constructor(options: DrizzleMemoryStoreOptions) {
    const db = runtimeDatabase(options.db);
    const resolvedOptions = resolveOptions(options);
    if (typeof db.transaction !== "function") {
      throw new TypeError("DrizzleMemoryStore requires db.transaction for atomic memory writes.");
    }
    if (resolvedOptions.lock === "advisory" && typeof db.execute !== "function") {
      throw new TypeError(
        'DrizzleMemoryStore with lock: "advisory" requires db.execute. Pass lock: "none" only when the database provides equivalent serialization.',
      );
    }
    this.db = options.db;
    this.schema = options.schema ?? drizzleMemorySchema;
    this.options = resolvedOptions;
  }

  async validate(): Promise<void> {
    const db = runtimeDatabase(this.db);
    const {
      agentMemorySessions: sessions,
      agentMemoryMessages: messages,
      agentMemoryErrors: errors,
    } = this.schema;
    await db
      .select({
        sessionId: sessions.id,
        scopeKey: sessions.scopeKey,
        messageId: messages.id,
        position: messages.position,
        message: messages.message,
      })
      .from(sessions)
      .leftJoin(messages, eq(messages.memorySessionId, sessions.id))
      .limit(0);
    if (this.options.errorPolicy === "store") {
      await db
        .select({ id: errors.id, memorySessionId: errors.memorySessionId, error: errors.error })
        .from(errors)
        .limit(0);
    }
  }

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
    const rows = (await db
      .select({ message: messages.message })
      .from(messages)
      .innerJoin(sessions, eq(messages.memorySessionId, sessions.id))
      .where(eq(sessions.scopeKey, this.scopeKey(scope)))
      .orderBy(asc(messages.position))) as MessageRow[];

    return rows.map((row) =>
      this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
    );
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    this.validateInputMessages(input.messages);

    const scopeKey = this.scopeKey(input.scope);

    await this.transaction(async (tx) => {
      await this.lock(tx, scopeKey);
      const session = await this.upsertSession(tx, input.scope, scopeKey);
      const { agentMemoryMessages: messages } = this.schema;
      const last = (await tx
        .select({ position: messages.position })
        .from(messages)
        .where(eq(messages.memorySessionId, session.id))
        .orderBy(desc(messages.position))
        .limit(1)) as PositionRow[];
      const start = (last[0]?.position ?? -1) + 1;

      await tx.insert(messages).values(
        input.messages.map((message, index) => ({
          memorySessionId: session.id,
          runId: input.runId,
          turn: input.turn,
          position: start + index,
          role: message.role,
          message,
        })),
      );
    });
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions } = this.schema;
    await db.delete(sessions).where(eq(sessions.scopeKey, this.scopeKey(scope)));
  }

  async recordError(input: MemoryErrorOptions): Promise<void> {
    if (this.options.errorPolicy === "ignore") {
      return;
    }
    this.validateInputMessages(input.messages);

    const scopeKey = this.scopeKey(input.scope);

    await this.transaction(async (tx) => {
      await this.lock(tx, scopeKey);
      const session = await this.upsertSession(tx, input.scope, scopeKey);
      await tx.insert(this.schema.agentMemoryErrors).values({
        memorySessionId: session.id,
        runId: input.runId,
        error: serializeUnknownError(input.error),
        messages: input.messages,
      });
    });
  }

  private async loadCompactionSnapshot(context: MemoryScope): Promise<MemoryCompactionSnapshot> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
    const rows = (await db
      .select({
        id: messages.id,
        position: messages.position,
        message: messages.message,
      })
      .from(messages)
      .innerJoin(sessions, eq(messages.memorySessionId, sessions.id))
      .where(eq(sessions.scopeKey, this.scopeKey(context)))
      .orderBy(asc(messages.position))) as CompactionMessageRow[];
    return {
      revision: compactionRevision(rows),
      messages: rows.map((row) =>
        this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
      ),
    };
  }

  private async replaceCompactionPrefix(
    input: MemoryCompactionReplacePrefixOptions,
  ): Promise<MemoryCompactionReplacePrefixResult> {
    this.validateInputMessages([input.replacement]);
    assertCompactionMessageCount(input.messageCount);
    const scopeKey = this.scopeKey(input.scope);

    return this.transaction(async (tx) => {
      await this.lock(tx, scopeKey);
      const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
      const rows = (await tx
        .select({
          id: messages.id,
          position: messages.position,
          message: messages.message,
        })
        .from(messages)
        .innerJoin(sessions, eq(messages.memorySessionId, sessions.id))
        .where(eq(sessions.scopeKey, scopeKey))
        .orderBy(asc(messages.position))) as CompactionMessageRow[];
      if (compactionRevision(rows) !== input.revision || input.messageCount > rows.length) {
        return { status: "conflict" };
      }
      const boundary = rows[input.messageCount - 1];
      if (boundary === undefined) {
        return { status: "conflict" };
      }
      const session = await this.upsertSession(tx, input.scope, scopeKey);
      await tx.delete(messages).where(
        inArray(
          messages.id,
          rows.slice(0, input.messageCount).map((row) => row.id),
        ),
      );
      await tx.insert(messages).values({
        memorySessionId: session.id,
        runId: input.runId,
        turn: 0,
        position: boundary.position,
        role: input.replacement.role,
        message: input.replacement,
      });
      return { status: "committed" };
    });
  }

  private async listConversations(
    options: MemoryConversationListOptions,
  ): Promise<MemoryConversationSummary[]> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
    let query = db
      .select({
        ref: sessions.id,
        sessionId: sessions.sessionId,
        userId: sessions.userId,
        metadata: sessions.metadata,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        messageCount: sql<number>`count(${messages.id})`,
      })
      .from(sessions)
      .leftJoin(messages, eq(messages.memorySessionId, sessions.id));
    if (options.userId !== undefined) {
      query = query.where(eq(sessions.userId, options.userId));
    }
    const rows = (await query
      .groupBy(sessions.id)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(options.limit)) as InspectionSessionRow[];
    return rows.map(inspectionSummary);
  }

  private async getConversation(ref: string): Promise<MemoryConversation | undefined> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
    const summaries = (await db
      .select({
        ref: sessions.id,
        sessionId: sessions.sessionId,
        userId: sessions.userId,
        metadata: sessions.metadata,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        messageCount: sql<number>`count(${messages.id})`,
      })
      .from(sessions)
      .leftJoin(messages, eq(messages.memorySessionId, sessions.id))
      .where(eq(sessions.id, ref))
      .groupBy(sessions.id)
      .limit(1)) as InspectionSessionRow[];
    const summary = summaries[0];
    if (summary === undefined) return undefined;

    const rows = (await db
      .select({
        position: messages.position,
        runId: messages.runId,
        turn: messages.turn,
        createdAt: messages.createdAt,
        message: messages.message,
      })
      .from(messages)
      .where(eq(messages.memorySessionId, ref))
      .orderBy(asc(messages.position))) as InspectionMessageRow[];

    return {
      ...inspectionSummary(summary),
      messages: rows.map((row) => ({
        position: row.position,
        runId: row.runId,
        turn: row.turn,
        createdAt: isoTimestamp(row.createdAt),
        message: this.options.validateMessages
          ? parseMemoryMessage(row.message)
          : (row.message as Message),
      })),
    };
  }

  private async transaction<T>(operation: (tx: DrizzleRuntimeDatabase) => Promise<T>): Promise<T> {
    const db = runtimeDatabase(this.db);
    if (typeof db.transaction !== "function") {
      throw new Error("DrizzleMemoryStore requires db.transaction for atomic memory writes.");
    }
    return db.transaction(operation);
  }

  private async lock(db: DrizzleRuntimeDatabase, scopeKey: string): Promise<void> {
    if (this.options.lock === "none") {
      return;
    }
    if (typeof db.execute !== "function") {
      throw new Error("DrizzleMemoryStore advisory locking requires db.execute.");
    }
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`);
  }

  private async upsertSession(
    db: DrizzleRuntimeDatabase,
    context: MemoryScope,
    scopeKey: string,
  ): Promise<SessionRow> {
    const { agentMemorySessions: sessions } = this.schema;
    const rows = (await db
      .insert(sessions)
      .values({
        scopeKey,
        sessionId: context.sessionId,
        userId: context.userId ?? null,
        metadata: metadata(context),
      })
      .onConflictDoUpdate({
        target: sessions.scopeKey,
        set: {
          sessionId: context.sessionId,
          userId: context.userId ?? null,
          metadata: metadata(context),
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: sessions.id })) as SessionRow[];

    const session = rows[0];
    if (session === undefined) {
      throw new Error("DrizzleMemoryStore failed to upsert memory session.");
    }
    return session;
  }

  private scopeKey(context: MemoryScope): string {
    if (typeof this.options.scopeKey === "function") {
      return this.options.scopeKey({ scope: context });
    }
    return createMemoryScopeKey({ scope: context, ...this.options.scopeKey });
  }

  private validateInputMessages(messages: Message[]): void {
    if (this.options.validateMessages) {
      for (const message of messages) {
        parseMemoryMessage(message);
      }
    }
  }
}

function resolveOptions(options: DrizzleMemoryStoreOptions): ResolvedDrizzleMemoryStoreOptions {
  return {
    scopeKey: options.scopeKey,
    errorPolicy: options.errorPolicy ?? "store",
    validateMessages: options.validateMessages ?? true,
    lock: options.lock ?? "advisory",
  };
}

function runtimeDatabase(db: DrizzleMemoryDatabaseLike): DrizzleRuntimeDatabase {
  if (!isRecord(db)) {
    throw new TypeError("DrizzleMemoryStore expected a Drizzle database-like object.");
  }
  for (const method of ["select", "insert", "delete"]) {
    if (typeof db[method] !== "function") {
      throw new TypeError(`DrizzleMemoryStore expected db.${method} to be a function.`);
    }
  }
  return db as DrizzleRuntimeDatabase;
}

function metadata(context: MemoryScope): JsonObject {
  return context.metadata ?? {};
}

function compactionRevision(rows: CompactionMessageRow[]): string {
  return JSON.stringify(rows.map((row) => row.id));
}

function assertCompactionMessageCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("messageCount must be a positive integer.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectionSummary(row: InspectionSessionRow): MemoryConversationSummary {
  const summary: MemoryConversationSummary = {
    ref: row.ref,
    sessionId: row.sessionId,
    metadata: row.metadata,
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
    messageCount: Number(row.messageCount),
  };
  if (row.userId !== null) summary.userId = row.userId;
  return summary;
}

function isoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
