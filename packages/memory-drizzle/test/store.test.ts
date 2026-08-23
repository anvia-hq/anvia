import { createMemoryScopeKey, type MemoryCompactionMessage, type Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { richMessages } from "../../core/test/helpers/rich-messages";
import * as memoryDrizzle from "../src/index.js";
import {
  agentMemoryErrors,
  agentMemoryMessages,
  agentMemorySessions,
  type DrizzleMemoryDatabaseLike,
  DrizzleMemoryStore,
  type DrizzleMemoryStoreOptions,
  drizzleMemorySchema,
} from "../src/index.js";
import { isMemoryMessage, serializeUnknownError } from "../src/message.js";

// @ts-expect-error The positional store factory was removed.
const removedStoreFactory = memoryDrizzle.createDrizzleMemoryStore;
// @ts-expect-error Scope-key creation is canonical in @anvia/core/memory.
const removedScopeKeyFactory = memoryDrizzle.createDrizzleMemoryScopeKey;
void removedStoreFactory;
void removedScopeKeyFactory;

const userMessage: Message = {
  role: "user",
  content: [{ type: "text", text: "remember this" }],
};

const assistantMessage: Message = {
  role: "assistant",
  content: [{ type: "text", text: "stored" }],
};

function memoryCompactionMessage(
  content: string,
  compactedMessageCount: number,
): MemoryCompactionMessage {
  return {
    role: "system",
    content,
    metadata: {
      anvia: { memoryCompaction: { version: 1, compactedMessageCount } },
    },
  };
}

describe("Drizzle memory public API", () => {
  it("uses core strict JSON validation for message metadata", async () => {
    const validMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
      metadata: { score: 1 },
    };
    const invalidMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
      metadata: { score: Number.NaN },
    };

    expect(isMemoryMessage(validMessage)).toBe(true);
    expect(isMemoryMessage(invalidMessage)).toBe(false);
    const store = createTestMemoryStore(new FakeDrizzleDb());
    await expect(
      store.append({
        scope: { sessionId: "thread-invalid" },
        runId: "run-invalid",
        turn: 0,
        messages: [invalidMessage],
      }),
    ).rejects.toThrow("valid Anvia Message");
  });

  it("serializes Error stacks only when present", () => {
    const withStack = new Error("failed");
    withStack.stack = "test stack";
    const withoutStack = new Error("failed");
    delete withoutStack.stack;

    expect(serializeUnknownError(withStack)).toEqual({
      name: "Error",
      message: "failed",
      stack: "test stack",
    });
    expect(serializeUnknownError(withoutStack)).toStrictEqual({
      name: "Error",
      message: "failed",
    });
    expect(serializeUnknownError(withoutStack)).not.toHaveProperty("stack");
  });

  it("exports schema tables users can include in their Drizzle schema", () => {
    expect(agentMemorySessions).toBe(drizzleMemorySchema.agentMemorySessions);
    expect(agentMemoryMessages).toBe(drizzleMemorySchema.agentMemoryMessages);
    expect(agentMemoryErrors).toBe(drizzleMemorySchema.agentMemoryErrors);
  });

  it("validates configured tables through a non-mutating read path", async () => {
    const db = new FakeDrizzleDb();
    const store = new DrizzleMemoryStore({ db });

    await expect(store.validate()).resolves.toBeUndefined();
    expect(db.events).toEqual([]);
    expect(db.sessions.size).toBe(0);
    expect(db.messages).toHaveLength(0);
    expect(db.errors).toHaveLength(0);
  });

  it("rejects databases without transaction support", () => {
    const db = new FakeDrizzleDb();
    const withoutTransactions = {
      select: db.select.bind(db),
      insert: db.insert.bind(db),
      delete: db.delete.bind(db),
      execute: db.execute.bind(db),
    };

    expect(() => new DrizzleMemoryStore({ db: withoutTransactions })).toThrow(
      "requires db.transaction",
    );
  });

  it("appends multiple turns, loads in position order, and clears scoped messages", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);
    const context = { sessionId: "thread-1", userId: "user-1" };

    await store.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage, assistantMessage],
    });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 1,
      messages: [userMessage],
    });

    expect(await store.load({ scope: context })).toEqual([
      userMessage,
      assistantMessage,
      userMessage,
    ]);
    expect(await store.load({ scope: { sessionId: "thread-1", userId: "user-2" } })).toEqual([]);
    expect(db.events).toEqual(["transaction", "lock", "transaction", "lock"]);

    await store.clear({ scope: context });
    expect(await store.load({ scope: context })).toEqual([]);
  });

  it("atomically compacts a prefix and rejects stale revisions", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);
    const context = { sessionId: "thread-compaction", userId: "user-1" };
    await store.append({
      scope: context,
      runId: "run-1",
      turn: 1,
      messages: [userMessage, assistantMessage],
    });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 1,
      messages: [userMessage],
    });
    const stale = await store.compaction.snapshot({ scope: context });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 2,
      messages: [assistantMessage],
    });
    const replacement = memoryCompactionMessage("Earlier conversation summary", 2);

    await expect(
      store.compaction.replacePrefix({
        scope: context,
        revision: stale.revision,
        messageCount: 2,
        replacement,
        runId: "memory-compaction:1",
      }),
    ).resolves.toEqual({ status: "conflict" });

    const current = await store.compaction.snapshot({ scope: context });
    await expect(
      store.compaction.replacePrefix({
        scope: context,
        revision: current.revision,
        messageCount: 2,
        replacement,
        runId: "memory-compaction:2",
      }),
    ).resolves.toEqual({ status: "committed" });
    await expect(store.load({ scope: context })).resolves.toEqual([
      replacement,
      userMessage,
      assistantMessage,
    ]);

    const [conversation] = await store.inspector.listConversations({ limit: 1 });
    const inspected =
      conversation === undefined
        ? undefined
        : await store.inspector.getConversation({ ref: conversation.ref });
    expect(inspected).toMatchObject({
      messageCount: 3,
      messages: [
        { position: 1, runId: "memory-compaction:2", turn: 0, message: replacement },
        { position: 2, runId: "run-2", turn: 1, message: userMessage },
        { position: 3, runId: "run-2", turn: 2, message: assistantMessage },
      ],
    });
  });

  it("inspects persisted conversations with ordered message records", async () => {
    const store = createTestMemoryStore(new FakeDrizzleDb());
    await store.append({
      scope: {
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
      },
      runId: "run-1",
      turn: 5,
      messages: [userMessage, assistantMessage],
    });

    const conversations = await store.inspector.listConversations({
      limit: 10,
      userId: "user-1",
    });
    expect(conversations).toEqual([
      {
        ref: "session-1",
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
        createdAt: "2026-07-17T01:00:00.000Z",
        updatedAt: "2026-07-17T01:05:00.000Z",
        messageCount: 2,
      },
    ]);
    await expect(store.inspector.getConversation({ ref: "session-1" })).resolves.toMatchObject({
      messages: [
        { position: 0, runId: "run-1", turn: 5, message: userMessage },
        { position: 1, runId: "run-1", turn: 5, message: assistantMessage },
      ],
    });
  });

  it("round-trips every supported message content shape", async () => {
    const store = createTestMemoryStore(new FakeDrizzleDb());
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ scope: context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load({ scope: context })).resolves.toEqual(richMessages);
  });

  it("does not open a transaction for empty appends", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);

    await store.append({
      scope: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [],
    });

    expect(db.events).toEqual([]);
    expect(await store.load({ scope: { sessionId: "thread-1" } })).toEqual([]);
  });

  it("stores and can ignore failed-run diagnostics", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);

    await store.recordError({
      scope: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(db.errors).toEqual([
      expect.objectContaining({
        runId: "run-1",
        error: expect.objectContaining({ name: "Error", message: "failed" }),
        messages: [userMessage],
      }),
    ]);
    expect(db.events).toEqual(["transaction", "lock"]);

    const ignoringDb = new FakeDrizzleDb();
    const ignoringStore = createTestMemoryStore(ignoringDb, { errorPolicy: "ignore" });

    await ignoringStore.recordError({
      scope: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(ignoringDb.events).toEqual([]);
    expect(ignoringDb.errors).toEqual([]);
  });

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);

    await store.recordError({
      scope: { sessionId: "thread-json" },
      runId: "run-json",
      error: { code: 409, retryable: false },
      messages: richMessages,
    });
    await store.recordError({
      scope: { sessionId: "thread-bigint" },
      runId: "run-bigint",
      error: 42n,
      messages: [],
    });

    expect(db.errors.map(({ runId, error, messages }) => ({ runId, error, messages }))).toEqual([
      {
        runId: "run-json",
        error: { code: 409, retryable: false },
        messages: richMessages,
      },
      { runId: "run-bigint", error: { message: "42" }, messages: [] },
    ]);
  });

  it("requires db.execute for advisory locking but supports lock none without it", async () => {
    const noExecuteDb = createNoExecuteDrizzleDb(new FakeDrizzleDb());
    expect(() => createTestMemoryStore(noExecuteDb)).toThrow(
      'with lock: "advisory" requires db.execute',
    );

    const unlockedDb = new FakeDrizzleDb();
    const unlockedStore = createTestMemoryStore(createNoExecuteDrizzleDb(unlockedDb), {
      lock: "none",
    });
    await unlockedStore.append({
      scope: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(await unlockedStore.load({ scope: { sessionId: "thread-1" } })).toEqual([userMessage]);
    expect(unlockedDb.events).toEqual(["transaction"]);
  });

  it("rejects malformed stored messages by default and can bypass validation", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db);
    const context = { sessionId: "thread-1" };
    const malformed = { role: "bad", content: [] };

    await store.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    db.replaceFirstMessage(malformed);

    await expect(store.load({ scope: context })).rejects.toThrow("valid Anvia Message");

    const unsafeStore = createTestMemoryStore(db, { validateMessages: false });
    await expect(unsafeStore.load({ scope: context })).resolves.toEqual([malformed]);
  });

  it("uses custom scope functions", async () => {
    const db = new FakeDrizzleDb();
    const store = createTestMemoryStore(db, {
      scopeKey: ({ scope }) => String(scope.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      scope: { sessionId: "thread-1", metadata: { tenantId: "tenant-1" } },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(db.scopeKeys()).toEqual(["tenant-1"]);
    await expect(
      store.load({
        scope: { sessionId: "different-thread", metadata: { tenantId: "tenant-1" } },
      }),
    ).resolves.toEqual([userMessage]);
  });

  it("creates stable scope keys from metadata paths", () => {
    expect(
      createMemoryScopeKey({
        scope: {
          sessionId: "thread-1",
          userId: "user-1",
          metadata: { tenant: { id: "tenant-1" } },
        },
        metadataKeys: ["tenant.id"],
      }),
    ).toBe(JSON.stringify(["thread-1", "user-1", "tenant-1"]));
  });

  it("keeps falsey metadata values and normalizes missing scope paths to null", () => {
    expect(
      createMemoryScopeKey({
        scope: { sessionId: "thread-1", metadata: { count: 0, enabled: false } },
        metadataKeys: ["count", "enabled", "missing.value"],
      }),
    ).toBe(JSON.stringify(["thread-1", null, 0, false, null]));
  });

  it("can omit user ids from generated scope keys", () => {
    expect(
      createMemoryScopeKey({
        scope: { sessionId: "thread-1", userId: "user-1" },
        includeUserId: false,
      }),
    ).toBe(JSON.stringify(["thread-1"]));
  });

  it("fails clearly when the database object is not Drizzle-like", () => {
    expect(() => createTestMemoryStore({})).toThrow(
      "DrizzleMemoryStore expected db.select to be a function.",
    );
  });

  it("rejects the removed positional constructor at compile time", () => {
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      const db = new FakeDrizzleDb();
      // @ts-expect-error DrizzleMemoryStore accepts one options object.
      new DrizzleMemoryStore(db);
      new DrizzleMemoryStore({
        db,
        // @ts-expect-error Scope-key configuration was renamed.
        scope: {},
      });
    }
  });
});

function createTestMemoryStore(
  db: DrizzleMemoryDatabaseLike,
  options: Omit<DrizzleMemoryStoreOptions, "db"> = {},
): DrizzleMemoryStore {
  return new DrizzleMemoryStore({ db, ...options });
}

type SessionRow = {
  id: string;
  scopeKey: string;
  sessionId: string;
  userId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  memorySessionId: string;
  position: number;
  runId: string;
  turn: number;
  createdAt: Date;
  message: unknown;
};

type ErrorRow = {
  memorySessionId: string;
  runId: string;
  error: unknown;
  messages: unknown;
};

class FakeDrizzleDb {
  readonly events: string[] = [];
  readonly sessions = new Map<string, SessionRow>();
  readonly messages = new Map<string, MessageRow[]>();
  readonly errors: ErrorRow[] = [];
  private nextSessionId = 1;
  private nextMessageId = 1;

  select(selection?: unknown): FakeSelectBuilder {
    return new FakeSelectBuilder(this, selection);
  }

  insert(table: unknown): FakeInsertBuilder {
    return new FakeInsertBuilder(this, table);
  }

  delete(table: unknown): FakeDeleteBuilder {
    return new FakeDeleteBuilder(this, table);
  }

  async transaction<T>(operation: (tx: FakeDrizzleDb) => Promise<T>): Promise<T> {
    this.events.push("transaction");
    return operation(this);
  }

  async execute(_query: unknown): Promise<unknown[]> {
    this.events.push("lock");
    return [];
  }

  scopeKeys(): string[] {
    return [...this.sessions.keys()];
  }

  replaceFirstMessage(message: unknown): void {
    const first = [...this.messages.values()][0]?.[0];
    if (first !== undefined) {
      first.message = message;
    }
  }

  selectRows(selection: unknown, fromTable: unknown, condition: unknown): unknown[] {
    if (fromTable === agentMemorySessions && hasSelection(selection, "ref")) {
      const filter = extractParam(condition);
      const sessions = [...this.sessions.values()];
      const exactSession = sessions.find((session) => session.id === filter);
      const rows =
        exactSession === undefined
          ? sessions.filter((session) => filter === undefined || session.userId === filter)
          : [exactSession];
      return rows.map((session) => ({
        ref: session.id,
        sessionId: session.sessionId,
        userId: session.userId,
        metadata: session.metadata,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: this.messages.get(session.id)?.length ?? 0,
      }));
    }

    if (fromTable !== agentMemoryMessages) {
      return [];
    }

    if (hasSelection(selection, "id")) {
      const scopeKey = String(extractParam(condition));
      const session = this.sessions.get(scopeKey);
      if (session === undefined) {
        return [];
      }
      return [...(this.messages.get(session.id) ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((row) => ({
          id: row.id,
          position: row.position,
          message: row.message,
        }));
    }

    if (hasSelection(selection, "runId")) {
      const memorySessionId = String(extractParam(condition));
      return [...(this.messages.get(memorySessionId) ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((row) => ({
          position: row.position,
          runId: row.runId,
          turn: row.turn,
          createdAt: row.createdAt,
          message: row.message,
        }));
    }

    if (hasSelection(selection, "message")) {
      const scopeKey = String(extractParam(condition));
      const session = this.sessions.get(scopeKey);
      if (session === undefined) {
        return [];
      }
      return [...(this.messages.get(session.id) ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((row) => ({ message: row.message }));
    }

    if (hasSelection(selection, "position")) {
      const memorySessionId = String(extractParam(condition));
      return [...(this.messages.get(memorySessionId) ?? [])]
        .sort((left, right) => right.position - left.position)
        .slice(0, 1)
        .map((row) => ({ position: row.position }));
    }

    return [];
  }

  upsertSession(value: unknown): SessionRow {
    const row = assertRecord(value);
    const scopeKey = String(row.scopeKey);
    const existing = this.sessions.get(scopeKey);
    if (existing !== undefined) {
      return existing;
    }

    const session = {
      id: `session-${this.nextSessionId}`,
      scopeKey,
      sessionId: String(row.sessionId),
      userId: row.userId === null ? null : String(row.userId),
      metadata: row.metadata,
      createdAt: new Date("2026-07-17T01:00:00.000Z"),
      updatedAt: new Date("2026-07-17T01:05:00.000Z"),
    };
    this.nextSessionId += 1;
    this.sessions.set(scopeKey, session);
    return session;
  }

  insertRows(table: unknown, value: unknown): void {
    if (table === agentMemoryMessages) {
      const rows = Array.isArray(value) ? value : [value];
      for (const row of rows) {
        const record = assertRecord(row);
        const memorySessionId = String(record.memorySessionId);
        this.messages.set(memorySessionId, [
          ...(this.messages.get(memorySessionId) ?? []),
          {
            id: `message-${this.nextMessageId++}`,
            memorySessionId,
            position: Number(record.position),
            runId: String(record.runId),
            turn: Number(record.turn),
            createdAt: new Date("2026-07-17T01:00:01.000Z"),
            message: record.message,
          },
        ]);
      }
      return;
    }

    if (table === agentMemoryErrors) {
      const record = assertRecord(value);
      this.errors.push({
        memorySessionId: String(record.memorySessionId),
        runId: String(record.runId),
        error: record.error,
        messages: record.messages,
      });
    }
  }

  deleteRows(table: unknown, condition: unknown): void {
    if (table === agentMemoryMessages) {
      const rawIds = extractParam(condition);
      const ids = new Set(
        Array.isArray(rawIds) ? rawIds.map(String) : extractParams(condition).map(String),
      );
      for (const [sessionId, messages] of this.messages) {
        this.messages.set(
          sessionId,
          messages.filter((message) => !ids.has(message.id)),
        );
      }
      return;
    }

    if (table !== agentMemorySessions) {
      return;
    }

    const scopeKey = String(extractParam(condition));
    const session = this.sessions.get(scopeKey);
    if (session !== undefined) {
      this.messages.delete(session.id);
      removeWhere(this.errors, (error) => error.memorySessionId === session.id);
    }
    this.sessions.delete(scopeKey);
  }
}

class FakeSelectBuilder {
  private fromTable: unknown;
  private condition: unknown;

  constructor(
    private readonly db: FakeDrizzleDb,
    private readonly selection: unknown,
  ) {}

  from(table: unknown): this {
    this.fromTable = table;
    return this;
  }

  innerJoin(_table: unknown, _condition: unknown): this {
    return this;
  }

  leftJoin(_table: unknown, _condition: unknown): this {
    return this;
  }

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  orderBy(..._columns: unknown[]): this | Promise<unknown[]> {
    return hasSelection(this.selection, "message") ? Promise.resolve(this.rows()) : this;
  }

  groupBy(..._columns: unknown[]): this {
    return this;
  }

  limit(_limit: number): Promise<unknown[]> {
    return Promise.resolve(this.rows());
  }

  private rows(): unknown[] {
    return this.db.selectRows(this.selection, this.fromTable, this.condition);
  }
}

class FakeInsertBuilder {
  private value: unknown;

  constructor(
    private readonly db: FakeDrizzleDb,
    private readonly table: unknown,
  ) {}

  values(value: unknown): this {
    this.value = value;
    if (this.table !== agentMemorySessions) {
      this.db.insertRows(this.table, this.value);
    }
    return this;
  }

  onConflictDoUpdate(_config: unknown): this {
    return this;
  }

  async returning(_selection?: unknown): Promise<unknown[]> {
    if (this.table !== agentMemorySessions) {
      return [];
    }
    return [this.db.upsertSession(this.value)];
  }
}

class FakeDeleteBuilder {
  constructor(
    private readonly db: FakeDrizzleDb,
    private readonly table: unknown,
  ) {}

  async where(condition: unknown): Promise<unknown[]> {
    this.db.deleteRows(this.table, condition);
    return [];
  }
}

function createNoExecuteDrizzleDb(db: FakeDrizzleDb): object {
  return {
    select: db.select.bind(db),
    insert: db.insert.bind(db),
    delete: db.delete.bind(db),
    transaction: db.transaction.bind(db),
  };
}

function extractParam(condition: unknown): unknown {
  const chunks =
    isRecord(condition) && Array.isArray(condition.queryChunks) ? condition.queryChunks : [];
  const param = chunks.find((chunk) => isRecord(chunk) && chunk.constructor.name === "Param");
  return isRecord(param) ? param.value : undefined;
}

function extractParams(condition: unknown): unknown[] {
  const values: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    if (value.constructor.name === "Param") {
      values.push(value.value);
      return;
    }
    if (Array.isArray(value.queryChunks)) {
      for (const chunk of value.queryChunks) {
        visit(chunk);
      }
    }
  };
  visit(condition);
  return values;
}

function hasSelection(selection: unknown, key: string): boolean {
  return isRecord(selection) && key in selection;
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("Expected a record.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      items.splice(index, 1);
    }
  }
}
