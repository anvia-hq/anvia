import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@anvia/core";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteMemoryScopeKey, createSqliteMemoryStore } from "../src/index.js";
import { isMemoryMessage } from "../src/message.js";

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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SqliteMemoryStore", () => {
  it("uses core strict JSON validation for message metadata", async () => {
    expect(isMemoryMessage({ ...userMessage, metadata: { score: 1 } })).toBe(true);
    expect(isMemoryMessage({ ...userMessage, metadata: { score: Number.NaN } })).toBe(false);
    const store = createSqliteMemoryStore();
    await expect(
      store.append({
        context: { sessionId: "thread-invalid" },
        runId: "run-invalid",
        turn: 0,
        messages: [{ ...userMessage, metadata: { score: Number.NaN } } as Message],
      }),
    ).rejects.toThrow("valid Anvia Message");
  });

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

  it("round-trips every supported message content shape", async () => {
    const store = createSqliteMemoryStore();
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load(context)).resolves.toEqual(richMessages);
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

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const store = createSqliteMemoryStore();

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

  it("keeps falsey metadata values and normalizes missing scope paths to null", () => {
    expect(
      createSqliteMemoryScopeKey(
        { sessionId: "thread-1", metadata: { count: 0, enabled: false } },
        { metadataKeys: ["count", "enabled", "missing.value"] },
      ),
    ).toBe(JSON.stringify(["thread-1", null, 0, false, null]));
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
