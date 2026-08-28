import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as memorySqlite from "../src/index.js";
import { createSqliteMemorySchemaSql, SqliteMemoryClient } from "../src/index.js";

// @ts-expect-error The legacy store factory was removed.
const removedStoreFactory = memorySqlite.createSqliteMemoryStore;
// @ts-expect-error Scope-key creation is canonical in @anvia/core/memory.
const removedScopeKeyFactory = memorySqlite.createSqliteMemoryScopeKey;
void removedStoreFactory;
void removedScopeKeyFactory;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SqliteMemoryClient", () => {
  it("constructs stores without opening or provisioning the database", async () => {
    const path = databasePath();
    const client = new SqliteMemoryClient({ path });
    const store = client.memoryStore();

    expect(existsSync(path)).toBe(false);
    await expect(store.load({ scope: { sessionId: "thread-1" } })).rejects.toThrow(
      "does not exist",
    );
    expect(existsSync(path)).toBe(false);
    await client.close();
    expect(existsSync(path)).toBe(false);
    await expect(store.load({ scope: { sessionId: "thread-1" } })).rejects.toThrow(
      "SqliteMemoryClient is closed",
    );
  });

  it("memoizes native initialization and closes internally created databases", async () => {
    const client = new SqliteMemoryClient({ path: databasePath() });
    const first = client.nativeClient();
    const second = client.nativeClient();

    expect(second).toBe(first);
    const database = await first;
    const firstClose = client[Symbol.asyncDispose]();
    const secondClose = client.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(() => database.prepare("SELECT 1")).toThrow();
    expect(() => client.nativeClient()).toThrow("SqliteMemoryClient is closed");
  });

  it("does not close injected databases", async () => {
    const database = new DatabaseSync(":memory:");
    const close = vi.spyOn(database, "close");
    const client = new SqliteMemoryClient({ database });

    await client.nativeClient();
    await client.close();

    expect(close).not.toHaveBeenCalled();
    database.close();
  });

  it("permits retry after native initialization fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-memory-invalid-database-"));
    tempDirs.push(directory);
    const client = new SqliteMemoryClient({ path: directory });

    const first = client.nativeClient();
    await expect(first).rejects.toThrow();
    const second = client.nativeClient();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
    await client.close();
  });

  it("rejects injected databases with foreign-key enforcement disabled", async () => {
    const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const client = new SqliteMemoryClient({ database });
    const store = client.memoryStore();

    await expect(store.ensure()).rejects.toThrow("foreign-key enforcement");

    await client.close();
    database.close();
  });

  it("rejects schemas without a unique session-position index", async () => {
    const database = new DatabaseSync(":memory:");
    const schemaWithoutUniquePosition = createSqliteMemorySchemaSql().replace(
      ",\n  UNIQUE(memory_session_id, position)",
      "",
    );
    database.exec(schemaWithoutUniquePosition);
    const client = new SqliteMemoryClient({ database });
    const store = client.memoryStore();

    await expect(store.validate()).rejects.toThrow("unique position index");

    await client.close();
    database.close();
  });

  it("ensures, validates, and isolates custom table names", async () => {
    const path = databasePath();
    const client = new SqliteMemoryClient({ path });
    const store = client.memoryStore({
      tablePrefix: "support_",
      tableNames: { sessions: "support_threads" },
    });

    await expect(store.validate()).rejects.toThrow("does not exist");
    expect(existsSync(path)).toBe(false);
    await store.ensure();
    await expect(store.validate()).resolves.toBeUndefined();
    const database = await client.nativeClient();
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    ).toEqual(
      expect.arrayContaining([
        { name: "support_threads" },
        { name: "support_memory_messages" },
        { name: "support_memory_errors" },
      ]),
    );
    await client.close();
  });

  it("upgrades existing session tables with compaction checkpoint storage", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(createSqliteMemorySchemaSql().replace("  compaction_state_json TEXT,\n", ""));
    const client = new SqliteMemoryClient({ database });
    const store = client.memoryStore();

    await expect(store.validate()).rejects.toThrow("compaction_state_json");
    await store.ensure();
    expect(
      database
        .prepare("PRAGMA table_info('anvia_memory_sessions')")
        .all()
        .some((column) => (column as { name: string }).name === "compaction_state_json"),
    ).toBe(true);

    await client.close();
    database.close();
  });

  it("rejects removed construction and provisioning options at compile time", () => {
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Native stores are created by SqliteMemoryClient.
      new memorySqlite.SqliteMemoryStore({});
      const client = new SqliteMemoryClient({ path: ":memory:" });
      client.memoryStore({
        // @ts-expect-error Provisioning is explicit through ensure().
        createIfMissing: true,
      });
      client.memoryStore({
        // @ts-expect-error Scope-key configuration was renamed.
        scope: {},
      });
    }
  });
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "anvia-memory-client-"));
  tempDirs.push(directory);
  return join(directory, "memory.sqlite");
}
