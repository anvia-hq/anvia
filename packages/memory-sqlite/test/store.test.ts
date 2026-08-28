import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMemoryScopeKey, type MemoryCompactionMessage, type Message } from "@anvia/core";
import { afterEach, describe, expect, it } from "vitest";
import { richMessages } from "../../core/test/helpers/rich-messages";
import {
  SqliteMemoryClient,
  type SqliteMemoryStore,
  type SqliteMemoryStoreOptions,
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

const tempDirs: string[] = [];
const databases = new Set<DatabaseSync>();
const storeDatabases = new WeakMap<SqliteMemoryStore, DatabaseSync>();

afterEach(async () => {
  for (const database of databases) database.close();
  databases.clear();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SqliteMemoryStore", () => {
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
    const store = await createTestMemoryStore();
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

  it("appends multiple turns, loads in position order, and clears scoped messages", async () => {
    const store = await createTestMemoryStore();
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
    expect(
      sqliteDatabase(store)
        .prepare("SELECT position FROM anvia_memory_messages ORDER BY position ASC")
        .all(),
    ).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);

    await store.clear({ scope: context });
    expect(await store.load({ scope: context })).toEqual([]);
  });

  it("atomically compacts a prefix and rejects stale revisions", async () => {
    const store = await createTestMemoryStore();
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
      userMessage,
      assistantMessage,
      userMessage,
      assistantMessage,
    ]);
    await expect(store.compaction.snapshot({ scope: context })).resolves.toMatchObject({
      messages: [replacement, userMessage, assistantMessage],
    });

    const [conversation] = await store.inspector.listConversations({ limit: 1 });
    const inspected =
      conversation === undefined
        ? undefined
        : await store.inspector.getConversation({ ref: conversation.ref });
    expect(inspected).toMatchObject({
      messageCount: 4,
      messages: [
        { position: 0, runId: "run-1", turn: 1, message: userMessage },
        { position: 1, runId: "run-1", turn: 1, message: assistantMessage },
        { position: 2, runId: "run-2", turn: 1, message: userMessage },
        { position: 3, runId: "run-2", turn: 2, message: assistantMessage },
      ],
    });

    await store.append({
      scope: context,
      runId: "run-3",
      turn: 1,
      messages: [userMessage, assistantMessage],
    });
    const repeated = await store.compaction.snapshot({ scope: context });
    const updatedReplacement = memoryCompactionMessage("Updated conversation summary", 4);
    await expect(
      store.compaction.replacePrefix({
        scope: context,
        revision: repeated.revision,
        messageCount: 3,
        replacement: updatedReplacement,
        runId: "memory-compaction:3",
      }),
    ).resolves.toEqual({ status: "committed" });
    await expect(store.load({ scope: context })).resolves.toHaveLength(6);
    await expect(store.compaction.snapshot({ scope: context })).resolves.toMatchObject({
      messages: [updatedReplacement, userMessage, assistantMessage],
    });
  });

  it("rejects a compaction checkpoint whose boundary is not in canonical history", async () => {
    const store = await createTestMemoryStore();
    const context = { sessionId: "thread-invalid-checkpoint", userId: "user-1" };
    await store.append({
      scope: context,
      runId: "run-1",
      turn: 1,
      messages: [userMessage],
    });
    sqliteDatabase(store)
      .prepare(
        `UPDATE anvia_memory_sessions
         SET compaction_state_json = $state
         WHERE scope_key = $scopeKey`,
      )
      .run({
        $scopeKey: createMemoryScopeKey({ scope: context }),
        $state: JSON.stringify({
          version: 1,
          generation: 1,
          summary: memoryCompactionMessage("Invalid boundary", 1),
          summarizedThroughPosition: 999,
        }),
      });

    await expect(store.compaction.snapshot({ scope: context })).rejects.toThrow(
      "compaction state boundary is invalid",
    );
    await expect(store.load({ scope: context })).resolves.toEqual([userMessage]);
  });

  it("inspects persisted conversations by opaque row reference", async () => {
    const store = await createTestMemoryStore();
    await store.append({
      scope: {
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
      },
      runId: "run-1",
      turn: 2,
      messages: [userMessage, assistantMessage],
    });
    await store.append({
      scope: { sessionId: "thread-2", userId: "user-2" },
      runId: "run-2",
      turn: 0,
      messages: [userMessage],
    });

    const conversations = await store.inspector.listConversations({
      limit: 10,
      userId: "user-1",
    });
    expect(conversations).toEqual([
      expect.objectContaining({
        ref: expect.any(String),
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
        messageCount: 2,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);

    const conversation = await store.inspector.getConversation({
      ref: conversations[0]?.ref ?? "",
    });
    expect(conversation).toMatchObject({
      sessionId: "thread-1",
      messages: [
        { position: 0, runId: "run-1", turn: 2, message: userMessage },
        { position: 1, runId: "run-1", turn: 2, message: assistantMessage },
      ],
    });
    await expect(store.inspector.getConversation({ ref: "missing" })).resolves.toBeUndefined();
  });

  it("round-trips every supported message content shape", async () => {
    const store = await createTestMemoryStore();
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ scope: context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load({ scope: context })).resolves.toEqual(richMessages);
  });

  it("persists messages when reopened from the same file path", async () => {
    const path = sqlitePath();
    const context = { sessionId: "thread-1", userId: "user-1" };

    const firstStore = await createTestMemoryStore({ path });
    await firstStore.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    const secondStore = await createTestMemoryStore({ path });
    await expect(secondStore.load({ scope: context })).resolves.toEqual([userMessage]);
  });

  it("stores failed-run diagnostics when enabled", async () => {
    const store = await createTestMemoryStore();

    await expect(
      store.recordError({
        scope: { sessionId: "thread-1" },
        runId: "run-1",
        error: new Error("failed"),
        messages: [userMessage],
      }),
    ).resolves.toBeUndefined();
  });

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const store = await createTestMemoryStore();

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

    const rows = sqliteDatabase(store)
      .prepare("SELECT run_id, error_json, messages_json FROM anvia_memory_errors ORDER BY rowid")
      .all() as Array<{ run_id: string; error_json: string; messages_json: string }>;
    expect(
      rows.map((row) => ({
        runId: row.run_id,
        error: JSON.parse(row.error_json) as unknown,
        messages: JSON.parse(row.messages_json) as unknown,
      })),
    ).toEqual([
      {
        runId: "run-json",
        error: { code: 409, retryable: false },
        messages: richMessages,
      },
      { runId: "run-bigint", error: { message: "42" }, messages: [] },
    ]);
  });

  it("does not create sessions when failed-run diagnostics are ignored", async () => {
    const store = await createTestMemoryStore({ errorPolicy: "ignore" });

    await store.recordError({
      scope: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(
      sqliteDatabase(store).prepare("SELECT COUNT(*) AS count FROM anvia_memory_sessions").get(),
    ).toEqual({ count: 0 });
  });

  it("rejects malformed stored messages by default", async () => {
    const store = await createTestMemoryStore();
    const context = { sessionId: "thread-1" };

    await store.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    sqliteDatabase(store)
      .prepare("UPDATE anvia_memory_messages SET message_json = $messageJson")
      .run({
        $messageJson: JSON.stringify({ role: "bad", content: [] }),
      });

    await expect(store.load({ scope: context })).rejects.toThrow("valid Anvia Message");
  });

  it("can bypass stored message validation", async () => {
    const store = await createTestMemoryStore({ validateMessages: false });
    const context = { sessionId: "thread-1" };
    const malformed = { role: "bad", content: [] };

    await store.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    sqliteDatabase(store)
      .prepare("UPDATE anvia_memory_messages SET message_json = $messageJson")
      .run({ $messageJson: JSON.stringify(malformed) });

    await expect(store.load({ scope: context })).resolves.toEqual([malformed]);
  });

  it("uses custom scope functions", async () => {
    const store = await createTestMemoryStore({
      scopeKey: ({ scope }) => String(scope.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      scope: { sessionId: "thread-1", userId: "user-1", metadata: { tenantId: "tenant-1" } },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    await expect(
      store.load({
        scope: { sessionId: "different-thread", metadata: { tenantId: "tenant-1" } },
      }),
    ).resolves.toEqual([userMessage]);
    await expect(
      store.load({ scope: { sessionId: "thread-1", metadata: { tenantId: "tenant-2" } } }),
    ).resolves.toEqual([]);
  });

  it("does not provision tables during ordinary operations", async () => {
    const path = sqlitePath();
    mkdirSync(join(path, ".."), { recursive: true });

    const store = await createTestMemoryStore({ path, ensure: false });

    await expect(store.load({ scope: { sessionId: "thread-1" } })).rejects.toThrow("no such table");
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
});

function sqliteDatabase(store: SqliteMemoryStore): DatabaseSync {
  const database = storeDatabases.get(store);
  if (database === undefined) throw new Error("Missing test database.");
  return database;
}

type CreateTestMemoryStoreOptions = SqliteMemoryStoreOptions & {
  path?: string | undefined;
  ensure?: boolean | undefined;
};

async function createTestMemoryStore(
  options: CreateTestMemoryStoreOptions = {},
): Promise<SqliteMemoryStore> {
  const { path = ":memory:", ensure = true, ...storeOptions } = options;
  if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true });
  const database = new DatabaseSync(path);
  databases.add(database);
  const client = new SqliteMemoryClient({ database });
  const store = client.memoryStore(storeOptions);
  storeDatabases.set(store, database);
  if (ensure) await store.ensure();
  return store;
}

function sqlitePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "anvia-memory-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "memory.sqlite");
}
