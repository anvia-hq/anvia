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
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
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

type CompactionSessionRow = SessionRow & {
  compactionState: unknown;
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
        compactionState: sessions.compactionState,
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
    const sessionRows = (await db
      .select({ id: sessions.id, compactionState: sessions.compactionState })
      .from(sessions)
      .where(eq(sessions.scopeKey, this.scopeKey(context)))
      .limit(1)) as CompactionSessionRow[];
    const session = sessionRows[0];
    if (session === undefined) {
      return { revision: compactionRevision([], undefined), messages: [] };
    }
    const state = this.compactionStateFromValue(session.compactionState);
    const rows = (await db
      .select({
        id: messages.id,
        position: messages.position,
        message: messages.message,
      })
      .from(messages)
      .where(
        state === undefined
          ? eq(messages.memorySessionId, session.id)
          : and(
              eq(messages.memorySessionId, session.id),
              gte(messages.position, state.summarizedThroughPosition),
            ),
      )
      .orderBy(asc(messages.position))) as CompactionMessageRow[];
    return {
      revision: compactionRevision(rows, state),
      messages: projectedMessages(rows, state, (row) =>
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
      const sessionRows = (await tx
        .select({ id: sessions.id, compactionState: sessions.compactionState })
        .from(sessions)
        .where(eq(sessions.scopeKey, scopeKey))
        .limit(1)) as CompactionSessionRow[];
      const session = sessionRows[0];
      if (session === undefined) return { status: "conflict" };
      const state = this.compactionStateFromValue(session.compactionState);
      const rows = (await tx
        .select({
          id: messages.id,
          position: messages.position,
          message: messages.message,
        })
        .from(messages)
        .where(
          state === undefined
            ? eq(messages.memorySessionId, session.id)
            : and(
                eq(messages.memorySessionId, session.id),
                gte(messages.position, state.summarizedThroughPosition),
              ),
        )
        .orderBy(asc(messages.position))) as CompactionMessageRow[];
      const activeRows = activeCompactionRows(rows, state);
      const physicalPrefixCount = input.messageCount - (state === undefined ? 0 : 1);
      if (
        compactionRevision(rows, state) !== input.revision ||
        physicalPrefixCount < 0 ||
        physicalPrefixCount > activeRows.length
      ) {
        return { status: "conflict" };
      }
      const summarizedThroughPosition =
        physicalPrefixCount === 0
          ? state?.summarizedThroughPosition
          : activeRows[physicalPrefixCount - 1]?.position;
      if (summarizedThroughPosition === undefined) {
        return { status: "conflict" };
      }
      await this.upsertSession(tx, input.scope, scopeKey, {
        version: 1,
        generation: (state?.generation ?? 0) + 1,
        summary: input.replacement,
        summarizedThroughPosition,
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
    compactionState?: StoredCompactionState,
  ): Promise<SessionRow> {
    const { agentMemorySessions: sessions } = this.schema;
    const rows = (await db
      .insert(sessions)
      .values({
        scopeKey,
        sessionId: context.sessionId,
        userId: context.userId ?? null,
        metadata: metadata(context),
        ...(compactionState === undefined ? {} : { compactionState }),
      })
      .onConflictDoUpdate({
        target: sessions.scopeKey,
        set: {
          sessionId: context.sessionId,
          userId: context.userId ?? null,
          metadata: metadata(context),
          ...(compactionState === undefined ? {} : { compactionState }),
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

  private compactionStateFromValue(value: unknown): StoredCompactionState | undefined {
    if (value === null || value === undefined) return undefined;
    return parseCompactionState(value, (message) =>
      this.options.validateMessages ? parseMemoryMessage(message) : (message as Message),
    );
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
    throw new Error("Drizzle memory compaction state boundary is invalid.");
  }
  return rows.slice(boundaryIndex + 1);
}

function parseCompactionState(
  value: unknown,
  parseMessage: (message: unknown) => Message,
): StoredCompactionState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Drizzle memory compaction state must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !Number.isSafeInteger(record.summarizedThroughPosition) ||
    (record.summarizedThroughPosition as number) < 0
  ) {
    throw new Error("Drizzle memory compaction state is invalid.");
  }
  const summary = parseMessage(record.summary);
  if (!isMemoryCompactionMessage(summary)) {
    throw new Error("Drizzle memory compaction state summary is invalid.");
  }
  return {
    version: 1,
    generation: record.generation as number,
    summarizedThroughPosition: record.summarizedThroughPosition as number,
    summary,
  };
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
