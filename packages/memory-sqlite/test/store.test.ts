import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@anvia/core";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteMemoryScopeKey, createSqliteMemoryStore } from "../src/index.js";

const userMessage: Message = {
  role: "user",
  content: [{ type: "text", text: "remember this" }],
};

const assistantMessage: Message = {
  role: "assistant",
  content: [{ type: "text", text: "stored" }],
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SqliteMemoryStore", () => {
  it("appends multiple turns, loads in position order, and clears scoped messages", async () => {
    const store = createSqliteMemoryStore();
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
    expect(
      sqliteDatabase(store)
        .prepare("SELECT position FROM anvia_memory_messages ORDER BY position ASC")
        .all(),
    ).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);

    await store.clear(context);
    expect(await store.load(context)).toEqual([]);
  });

  it("persists messages when reopened from the same file path", async () => {
    const path = sqlitePath();
    const context = { sessionId: "thread-1", userId: "user-1" };

    await createSqliteMemoryStore({ path }).append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    await expect(createSqliteMemoryStore({ path }).load(context)).resolves.toEqual([userMessage]);
  });

  it("stores failed-run diagnostics when enabled", async () => {
    const store = createSqliteMemoryStore();

    await expect(
      store.recordError({
        context: { sessionId: "thread-1" },
        runId: "run-1",
        error: new Error("failed"),
        messages: [userMessage],
      }),
    ).resolves.toBeUndefined();
  });

  it("does not create sessions when failed-run diagnostics are ignored", async () => {
    const store = createSqliteMemoryStore({ errors: "ignore" });

    await store.recordError({
      context: { sessionId: "thread-1" },
      runId: "run-1",
      error: new Error("failed"),
      messages: [userMessage],
    });

    expect(
      sqliteDatabase(store).prepare("SELECT COUNT(*) AS count FROM anvia_memory_sessions").get(),
    ).toEqual({ count: 0 });
  });

  it("rejects malformed stored messages by default", async () => {
    const store = createSqliteMemoryStore();
    const context = { sessionId: "thread-1" };

    await store.append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    sqliteDatabase(store)
      .prepare("UPDATE anvia_memory_messages SET message_json = $messageJson")
      .run({
        $messageJson: JSON.stringify({ role: "bad", content: [] }),
      });

    await expect(store.load(context)).rejects.toThrow("valid Anvia Message");
  });

  it("can bypass stored message validation", async () => {
    const store = createSqliteMemoryStore({ validateMessages: false });
    const context = { sessionId: "thread-1" };
    const malformed = { role: "bad", content: [] };

    await store.append({
      context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    sqliteDatabase(store)
      .prepare("UPDATE anvia_memory_messages SET message_json = $messageJson")
      .run({ $messageJson: JSON.stringify(malformed) });

    await expect(store.load(context)).resolves.toEqual([malformed]);
  });

  it("uses custom scope functions", async () => {
    const store = createSqliteMemoryStore({
      scope: (context) => String(context.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      context: { sessionId: "thread-1", userId: "user-1", metadata: { tenantId: "tenant-1" } },
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });

    await expect(
      store.load({ sessionId: "different-thread", metadata: { tenantId: "tenant-1" } }),
    ).resolves.toEqual([userMessage]);
    await expect(
      store.load({ sessionId: "thread-1", metadata: { tenantId: "tenant-2" } }),
    ).resolves.toEqual([]);
  });

  it("surfaces missing-table errors when createIfMissing is disabled", async () => {
    const path = sqlitePath();
    mkdirSync(join(path, ".."), { recursive: true });

    const store = createSqliteMemoryStore({ path, createIfMissing: false });

    await expect(store.load({ sessionId: "thread-1" })).rejects.toThrow("no such table");
  });

  it("creates stable scope keys from metadata paths", () => {
    expect(
      createSqliteMemoryScopeKey(
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
      createSqliteMemoryScopeKey(
        { sessionId: "thread-1", userId: "user-1" },
        { includeUserId: false },
      ),
    ).toBe(JSON.stringify(["thread-1"]));
  });
});

type SqliteStatement = {
  all(params?: unknown): unknown[];
  get(params?: unknown): unknown;
  run(params?: unknown): unknown;
};

type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
};

function sqliteDatabase(store: unknown): SqliteDatabase {
  return (store as { database(): SqliteDatabase }).database();
}

function sqlitePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "anvia-memory-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "memory.sqlite");
}
