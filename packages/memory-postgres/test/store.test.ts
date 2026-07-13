import type { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import type {
  PostgresMemoryClientLike,
  PostgresMemoryQueryResult,
  PostgresMemoryTransactionClientLike,
} from "../src/index.js";
import {
  createPostgresMemorySchemaSql,
  createPostgresMemoryScopeKey,
  createPostgresMemoryStore,
} from "../src/index.js";
import { isMemoryMessage, serializeUnknownError } from "../src/message.js";

const userMessage: Message = {
  role: "user",
  content: [{ type: "text", text: "remember this" }],
};

const assistantMessage: Message = {
  role: "assistant",
  content: [{ type: "text", text: "stored" }],
};

const richMessages: Message[] = [
  { role: "system", content: "System instructions", metadata: { source: "system" } },
  {
    role: "user",
    metadata: { composer: { entities: [{ id: "document-1" }] } },
    content: [
      { type: "text", text: "Inspect these", signature: "user-signature" },
      {
        type: "image",
        source: { type: "url", url: "https://example.test/image.png" },
        detail: "high",
      },
      {
        type: "image",
        source: { type: "base64", data: "aW1hZ2U=", mediaType: "image/png" },
        detail: "low",
      },
      {
        type: "document",
        source: {
          type: "url",
          url: "https://example.test/report.pdf",
          mediaType: "application/pdf",
          filename: "report.pdf",
        },
      },
      {
        type: "document",
        source: {
          type: "base64",
          data: "cmVwb3J0",
          mediaType: "application/pdf",
          filename: "inline.pdf",
        },
      },
      {
        type: "document",
        source: { type: "text", text: "inline document", mediaType: "text/plain" },
      },
    ],
  },
  {
    role: "assistant",
    id: "assistant-1",
    metadata: { source: "assistant" },
    content: [
      { type: "text", text: "Working", signature: "assistant-signature" },
      {
        type: "reasoning",
        id: "reasoning-1",
        text: "analysis summary",
        content: [
          { type: "text", text: "analysis", signature: "reasoning-signature" },
          { type: "summary", text: " summary" },
          { type: "encrypted", data: "ciphertext" },
          { type: "redacted", data: "redacted-data" },
        ],
      },
      {
        type: "tool_call",
        id: "tool-1",
        callId: "call-1",
        function: { name: "lookup", arguments: { query: "Anvia", limit: 3 } },
        signature: "tool-signature",
        additionalParams: { provider: "test" },
      },
      {
        type: "image",
        source: { type: "base64", data: "b3V0cHV0", mediaType: "image/png" },
        detail: "auto",
      },
    ],
  },
  {
    role: "tool",
    metadata: { source: "tool" },
    content: [
      {
        type: "tool_result",
        id: "tool-1",
        callId: "call-1",
        toolName: "lookup",
        content: [
          { type: "text", text: "result" },
          { type: "image", data: "cmVzdWx0", mediaType: "image/png" },
        ],
      },
    ],
  },
];

type FakePgCall = {
  text: string;
  values: readonly unknown[];
};

type FakePgState = {
  nextSessionId: number;
  sessions: Map<string, { id: string }>;
  messages: Map<string, Array<{ position: number; message: unknown }>>;
  errors: Array<{ memorySessionId: string; runId: string; error: unknown; messages: unknown }>;
};

class FakePgClient implements PostgresMemoryClientLike {
  readonly calls: FakePgCall[] = [];
  failMessageInsert = false;

  constructor(
    private readonly state: FakePgState = {
      nextSessionId: 1,
      sessions: new Map(),
      messages: new Map(),
      errors: [],
    },
  ) {}

  get queries(): string[] {
    return this.calls.map((call) => call.text);
  }

  get errors(): FakePgState["errors"] {
    return this.state.errors;
  }

  scopeKeys(): string[] {
    return [...this.state.sessions.keys()];
  }

  replaceFirstMessage(message: unknown): void {
    const first = [...this.state.messages.values()][0]?.[0];
    if (first !== undefined) {
      first.message = message;
    }
  }

  async query(text: string, values: readonly unknown[] = []): Promise<PostgresMemoryQueryResult> {
    this.calls.push({ text, values });

    if (
      text === "BEGIN" ||
      text === "COMMIT" ||
      text === "ROLLBACK" ||
      text.startsWith("CREATE EXTENSION") ||
      text.includes("pg_advisory_xact_lock")
    ) {
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO") && text.includes("memory_sessions")) {
      const scopeKey = values[0] as string;
      const current = this.state.sessions.get(scopeKey) ?? {
        id: `session-${this.state.nextSessionId}`,
      };
      this.state.nextSessionId += this.state.sessions.has(scopeKey) ? 0 : 1;
      this.state.sessions.set(scopeKey, current);
      return { rows: [current] };
    }

    if (text.includes("SELECT position") && text.includes("memory_messages")) {
      const rows = [...(this.state.messages.get(values[0] as string) ?? [])].sort(
        (left, right) => right.position - left.position,
      );
      return { rows: rows.length === 0 ? [] : [{ position: rows[0]?.position }] };
    }

    if (text.startsWith("INSERT INTO") && text.includes("memory_messages")) {
      if (this.failMessageInsert) {
        throw new Error("insert failed");
      }
      for (let index = 0; index < values.length; index += 6) {
        const memorySessionId = values[index] as string;
        const row = {
          position: values[index + 3] as number,
          message: JSON.parse(values[index + 5] as string) as unknown,
        };
        this.state.messages.set(memorySessionId, [
          ...(this.state.messages.get(memorySessionId) ?? []),
          row,
        ]);
      }
      return { rows: [] };
    }

    if (text.includes("SELECT m.message")) {
      const session = this.state.sessions.get(values[0] as string);
      const rows =
        session === undefined
          ? []
          : (this.state.messages.get(session.id) ?? [])
              .sort((left, right) => left.position - right.position)
              .map((row) => ({ message: row.message }));
      return { rows };
    }

    if (text.startsWith("DELETE FROM")) {
      const session = this.state.sessions.get(values[0] as string);
      if (session !== undefined) {
        this.state.messages.delete(session.id);
      }
      this.state.sessions.delete(values[0] as string);
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO") && text.includes("memory_errors")) {
      this.state.errors.push({
        memorySessionId: values[0] as string,
        runId: values[1] as string,
        error: JSON.parse(values[2] as string) as unknown,
        messages: JSON.parse(values[3] as string) as unknown,
      });
      return { rows: [] };
    }

    return { rows: [] };
  }
}

class FakePgTransactionClient extends FakePgClient implements PostgresMemoryTransactionClientLike {
  released = false;

  release(): void {
    this.released = true;
  }
}

class FakePgPool extends FakePgClient {
  readonly transactionClient: FakePgTransactionClient;
  connectCalls = 0;

  constructor() {
    const state: FakePgState = {
      nextSessionId: 1,
      sessions: new Map(),
      messages: new Map(),
      errors: [],
    };
    super(state);
    this.transactionClient = new FakePgTransactionClient(state);
  }

  async connect(): Promise<FakePgTransactionClient> {
    this.connectCalls += 1;
    return this.transactionClient;
  }
}

describe("PostgresMemoryStore", () => {
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
    const store = await createPostgresMemoryStore({
      client: new FakePgClient(),
      createIfMissing: false,
    });
    await expect(
      store.append({
        context: { sessionId: "thread-invalid" },
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

  it("appends multiple turns, loads in position order, and clears scoped messages", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });
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

    await store.clear(context);
    expect(await store.load(context)).toEqual([]);
    expect(client.queries.some((query) => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(client.queries.filter((query) => query === "BEGIN")).toHaveLength(2);
    expect(client.queries.filter((query) => query === "COMMIT")).toHaveLength(2);
  });

  it("round-trips every supported message content shape", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load(context)).resolves.toEqual(richMessages);
  });

  it("does not open a transaction for empty appends", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });

    await store.append({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [],
    });

    expect(client.calls).toEqual([]);
  });

  it("creates schema SQL by default", async () => {
    const client = new FakePgClient();

    await createPostgresMemoryStore({ client });

    expect(client.queries[0]).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(client.queries[0]).toContain('"anvia_memory_sessions"');
  });

  it("rolls back failed transactional appends", async () => {
    const client = new FakePgClient();
    client.failMessageInsert = true;
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });

    await expect(
      store.append({
        context: { sessionId: "thread-1" },
        runId: "run-1",
        turn: 0,
        messages: [userMessage],
      }),
    ).rejects.toThrow("insert failed");

    expect(client.queries).toContain("ROLLBACK");
    expect(client.queries).not.toContain("COMMIT");
  });

  it("checks out and releases a transaction client when given a pool", async () => {
    const pool = new FakePgPool();
    const store = await createPostgresMemoryStore({ client: pool, createIfMissing: false });

    await store.append({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(pool.connectCalls).toBe(1);
    expect(pool.transactionClient.released).toBe(true);
    expect(pool.transactionClient.queries).toContain("BEGIN");
    expect(pool.queries).not.toContain("BEGIN");
  });

  it("stores and can ignore failed-run diagnostics", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });

    await store.recordError({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(client.errors).toEqual([
      expect.objectContaining({
        runId: "run-1",
        error: expect.objectContaining({ name: "Error", message: "failed" }),
        messages: [userMessage],
      }),
    ]);

    const ignoringClient = new FakePgClient();
    const ignoringStore = await createPostgresMemoryStore({
      client: ignoringClient,
      createIfMissing: false,
      errors: "ignore",
    });

    await ignoringStore.recordError({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(ignoringClient.calls).toEqual([]);
    expect(ignoringClient.errors).toEqual([]);
  });

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });

    await store.recordError({
      context: { sessionId: "thread-json" },
      runId: "run-json",
      error: { code: 409, retryable: false },
      messages: richMessages,
    });
    await store.recordError({
      context: { sessionId: "thread-bigint" },
      runId: "run-bigint",
      error: 42n,
      messages: [],
    });

    expect(client.errors.map(({ runId, error, messages }) => ({ runId, error, messages }))).toEqual(
      [
        {
          runId: "run-json",
          error: { code: 409, retryable: false },
          messages: richMessages,
        },
        { runId: "run-bigint", error: { message: "42" }, messages: [] },
      ],
    );
  });

  it("can disable advisory locking", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({
      client,
      createIfMissing: false,
      lock: "none",
    });

    await store.append({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(client.queries.some((query) => query.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("uses custom scope functions", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({
      client,
      createIfMissing: false,
      scope: (context) => String(context.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      context: { sessionId: "thread-1", metadata: { tenantId: "tenant-1" } },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    expect(client.scopeKeys()).toEqual(["tenant-1"]);
    await expect(
      store.load({ sessionId: "different-thread", metadata: { tenantId: "tenant-1" } }),
    ).resolves.toEqual([userMessage]);
  });

  it("rejects malformed stored messages by default and can bypass validation", async () => {
    const client = new FakePgClient();
    const store = await createPostgresMemoryStore({ client, createIfMissing: false });
    const context = { sessionId: "thread-1" };
    const malformed = { role: "bad", content: [] };

    await store.append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    client.replaceFirstMessage(malformed);

    await expect(store.load(context)).rejects.toThrow("valid Anvia Message");

    const unsafeStore = await createPostgresMemoryStore({
      client,
      createIfMissing: false,
      validateMessages: false,
    });
    await expect(unsafeStore.load(context)).resolves.toEqual([malformed]);
  });

  it("creates quoted schema SQL and rejects invalid identifiers", () => {
    expect(createPostgresMemorySchemaSql()).toContain('"anvia_memory_sessions"');
    expect(() =>
      createPostgresMemorySchemaSql({
        tableNames: { sessions: "bad-name" },
      }),
    ).toThrow("Invalid Postgres identifier");
  });

  it("creates stable scope keys from metadata paths", () => {
    expect(
      createPostgresMemoryScopeKey(
        {
          sessionId: "thread-1",
          userId: "user-1",
          metadata: { tenant: { id: "tenant-1" } },
        },
        { metadataKeys: ["tenant.id"] },
      ),
    ).toBe(JSON.stringify(["thread-1", "user-1", "tenant-1"]));
  });

  it("keeps falsey metadata values and normalizes missing scope paths to null", () => {
    expect(
      createPostgresMemoryScopeKey(
        { sessionId: "thread-1", metadata: { count: 0, enabled: false } },
        { metadataKeys: ["count", "enabled", "missing.value"] },
      ),
    ).toBe(JSON.stringify(["thread-1", null, 0, false, null]));
  });

  it("can omit user ids from generated scope keys", () => {
    expect(
      createPostgresMemoryScopeKey(
        { sessionId: "thread-1", userId: "user-1" },
        { includeUserId: false },
      ),
    ).toBe(JSON.stringify(["thread-1"]));
  });
});
