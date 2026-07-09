import type { JsonObject, JsonValue, MemoryStore, Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { asc, desc, eq, sql } from "drizzle-orm";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import { drizzleMemorySchema } from "./schema.js";
import type {
  DrizzleMemoryDatabaseLike,
  DrizzleMemorySchema,
  DrizzleMemoryScopeOptions,
  DrizzleMemoryStoreOptions,
} from "./types.js";

const defaultScopeOptions: { includeUserId: boolean; metadataKeys: string[] } = {
  includeUserId: true,
  metadataKeys: [],
};

type ResolvedDrizzleMemoryStoreOptions = Required<
  Pick<DrizzleMemoryStoreOptions, "errors" | "lock" | "validateMessages">
> &
  Pick<DrizzleMemoryStoreOptions, "scope">;

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
  where(condition: unknown): DrizzleSelectBuilder;
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

export function createDrizzleMemoryStore(
  db: DrizzleMemoryDatabaseLike,
  options: DrizzleMemoryStoreOptions = {},
): DrizzleMemoryStore {
  return new DrizzleMemoryStore(db, options.schema ?? drizzleMemorySchema, resolveOptions(options));
}

export function createDrizzleMemoryScopeKey(
  context: MemoryContext,
  options: DrizzleMemoryScopeOptions = {},
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

export class DrizzleMemoryStore implements MemoryStore {
  readonly kind = "drizzle";

  constructor(
    private readonly db: DrizzleMemoryDatabaseLike,
    private readonly schema: DrizzleMemorySchema,
    private readonly options: ResolvedDrizzleMemoryStoreOptions,
  ) {}

  async load(context: MemoryContext): Promise<Message[]> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions, agentMemoryMessages: messages } = this.schema;
    const rows = (await db
      .select({ message: messages.message })
      .from(messages)
      .innerJoin(sessions, eq(messages.memorySessionId, sessions.id))
      .where(eq(sessions.scopeKey, this.scopeKey(context)))
      .orderBy(asc(messages.position))) as MessageRow[];

    return rows.map((row) =>
      this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
    );
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    const scopeKey = this.scopeKey(input.context);

    await this.transaction(async (tx) => {
      await this.lock(tx, scopeKey);
      const session = await this.upsertSession(tx, input.context, scopeKey);
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

  async clear(context: MemoryContext): Promise<void> {
    const db = runtimeDatabase(this.db);
    const { agentMemorySessions: sessions } = this.schema;
    await db.delete(sessions).where(eq(sessions.scopeKey, this.scopeKey(context)));
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    if (this.options.errors === "ignore") {
      return;
    }

    const scopeKey = this.scopeKey(input.context);

    await this.transaction(async (tx) => {
      await this.lock(tx, scopeKey);
      const session = await this.upsertSession(tx, input.context, scopeKey);
      await tx.insert(this.schema.agentMemoryErrors).values({
        memorySessionId: session.id,
        runId: input.runId,
        error: serializeUnknownError(input.error),
        messages: input.messages,
      });
    });
  }

  private async transaction<T>(operation: (tx: DrizzleRuntimeDatabase) => Promise<T>): Promise<T> {
    const db = runtimeDatabase(this.db);
    if (typeof db.transaction === "function") {
      return db.transaction(operation);
    }
    return operation(db);
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
    context: MemoryContext,
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

  private scopeKey(context: MemoryContext): string {
    if (typeof this.options.scope === "function") {
      return this.options.scope(context);
    }
    return createDrizzleMemoryScopeKey(context, this.options.scope);
  }
}

function resolveOptions(options: DrizzleMemoryStoreOptions): ResolvedDrizzleMemoryStoreOptions {
  return {
    scope: options.scope,
    errors: options.errors ?? "store",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
