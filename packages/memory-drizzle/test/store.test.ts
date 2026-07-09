import type { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import {
  agentMemoryErrors,
  agentMemoryMessages,
  agentMemorySessions,
  createDrizzleMemoryScopeKey,
  createDrizzleMemoryStore,
  drizzleMemorySchema,
} from "../src/index.js";

const userMessage: Message = {
  role: "user",
  content: [{ type: "text", text: "remember this" }],
};

const assistantMessage: Message = {
  role: "assistant",
  content: [{ type: "text", text: "stored" }],
};

describe("Drizzle memory public API", () => {
  it("exports schema tables users can include in their Drizzle schema", () => {
    expect(agentMemorySessions).toBe(drizzleMemorySchema.agentMemorySessions);
    expect(agentMemoryMessages).toBe(drizzleMemorySchema.agentMemoryMessages);
    expect(agentMemoryErrors).toBe(drizzleMemorySchema.agentMemoryErrors);
  });

  it("appends multiple turns, loads in position order, and clears scoped messages", async () => {
    const db = new FakeDrizzleDb();
    const store = createDrizzleMemoryStore(db);
    const context = { sessionId: "thread-1", userId: "user-1" };

    await store.append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage, assistantMessage],
    });
    await store.append({
      context,
      runId: "run-2",
      turn: 1,
      messages: [userMessage],
    });

    expect(await store.load(context)).toEqual([userMessage, assistantMessage, userMessage]);
    expect(await store.load({ sessionId: "thread-1", userId: "user-2" })).toEqual([]);
    expect(db.events).toEqual(["transaction", "lock", "transaction", "lock"]);

    await store.clear(context);
    expect(await store.load(context)).toEqual([]);
  });

  it("does not open a transaction for empty appends", async () => {
    const db = new FakeDrizzleDb();
    const store = createDrizzleMemoryStore(db);

    await store.append({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [],
    });

    expect(db.events).toEqual([]);
    expect(await store.load({ sessionId: "thread-1" })).toEqual([]);
  });

  it("stores and can ignore failed-run diagnostics", async () => {
    const db = new FakeDrizzleDb();
    const store = createDrizzleMemoryStore(db);

    await store.recordError({
      context: { sessionId: "thread-1" },
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
    const ignoringStore = createDrizzleMemoryStore(ignoringDb, { errors: "ignore" });

    await ignoringStore.recordError({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(ignoringDb.events).toEqual([]);
    expect(ignoringDb.errors).toEqual([]);
  });

  it("requires db.execute for advisory locking but supports lock none without it", async () => {
    const noExecuteDb = createNoExecuteDrizzleDb(new FakeDrizzleDb());
    const lockingStore = createDrizzleMemoryStore(noExecuteDb);

    await expect(
      lockingStore.append({
        context: { sessionId: "thread-1" },
        runId: "run-1",
        turn: 0,
        messages: [userMessage],
      }),
    ).rejects.toThrow("advisory locking requires db.execute");

    const unlockedDb = new FakeDrizzleDb();
    const unlockedStore = createDrizzleMemoryStore(createNoExecuteDrizzleDb(unlockedDb), {
      lock: "none",
    });
    await unlockedStore.append({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(await unlockedStore.load({ sessionId: "thread-1" })).toEqual([userMessage]);
    expect(unlockedDb.events).toEqual([]);
  });

  it("rejects malformed stored messages by default and can bypass validation", async () => {
    const db = new FakeDrizzleDb();
    const store = createDrizzleMemoryStore(db);
    const context = { sessionId: "thread-1" };
    const malformed = { role: "bad", content: [] };

    await store.append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    db.replaceFirstMessage(malformed);

    await expect(store.load(context)).rejects.toThrow("valid Anvia Message");

    const unsafeStore = createDrizzleMemoryStore(db, { validateMessages: false });
    await expect(unsafeStore.load(context)).resolves.toEqual([malformed]);
  });

  it("uses custom scope functions", async () => {
    const db = new FakeDrizzleDb();
    const store = createDrizzleMemoryStore(db, {
      scope: (context) => String(context.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      context: { sessionId: "thread-1", metadata: { tenantId: "tenant-1" } },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(db.scopeKeys()).toEqual(["tenant-1"]);
    await expect(
      store.load({ sessionId: "different-thread", metadata: { tenantId: "tenant-1" } }),
    ).resolves.toEqual([userMessage]);
  });

  it("creates stable scope keys from metadata paths", () => {
    expect(
      createDrizzleMemoryScopeKey(
        {
          sessionId: "thread-1",
          userId: "user-1",
          metadata: { tenant: { id: "tenant-1" } },
        },
        { metadataKeys: ["tenant.id"] },
      ),
    ).toBe(JSON.stringify(["thread-1", "user-1", "tenant-1"]));
  });

  it("can omit user ids from generated scope keys", () => {
    expect(
      createDrizzleMemoryScopeKey(
        { sessionId: "thread-1", userId: "user-1" },
        { includeUserId: false },
      ),
    ).toBe(JSON.stringify(["thread-1"]));
  });

  it("fails clearly when the database object is not Drizzle-like", async () => {
    const store = createDrizzleMemoryStore({});

    await expect(store.load({ sessionId: "thread-1" })).rejects.toThrow(
      "DrizzleMemoryStore expected db.select to be a function.",
    );
  });
});

type SessionRow = {
  id: string;
  scopeKey: string;
};

type MessageRow = {
  memorySessionId: string;
  position: number;
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
    if (fromTable !== agentMemoryMessages) {
      return [];
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

    const session = { id: `session-${this.nextSessionId}`, scopeKey };
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
            memorySessionId,
            position: Number(record.position),
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

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  orderBy(..._columns: unknown[]): this | Promise<unknown[]> {
    return hasSelection(this.selection, "message") ? Promise.resolve(this.rows()) : this;
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
  };
}

function extractParam(condition: unknown): unknown {
  const chunks =
    isRecord(condition) && Array.isArray(condition.queryChunks) ? condition.queryChunks : [];
  const param = chunks.find((chunk) => isRecord(chunk) && chunk.constructor.name === "Param");
  return isRecord(param) ? param.value : undefined;
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
