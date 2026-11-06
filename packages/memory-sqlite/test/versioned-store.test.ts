import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryCompactionMessage, Message } from "@anvia/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteMemoryClient,
  type SqliteMemoryStore,
  type SqliteMemoryStoreOptions,
} from "../src/index.js";

const scope = { sessionId: "thread-versioned" };

const userMessage: Message = { role: "user", content: [{ type: "text", text: "hello" }] };
const assistantMessage: Message = {
  role: "assistant",
  content: [{ type: "text", text: "hi" }],
};

const tempDirs: string[] = [];
const databases = new Set<DatabaseSync>();

afterEach(async () => {
  for (const database of databases) database.close();
  databases.clear();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SqliteMemoryStore versioned and idempotent writes", () => {
  it("commits a keyed write once, treats a same-content retry as a duplicate", async () => {
    const store = await createStore();
    const write = {
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      idempotencyKey: "key-1",
    };

    const first = await store.append(write);
    expect(first.status).toBe("committed");
    const retry = await store.append(write);
    expect(retry).toEqual({ status: "duplicate", version: first.version });
    await expect(store.load({ scope })).resolves.toEqual([userMessage]);
  });

  it("checks the duplicate before the version, so a retry after success is not a conflict", async () => {
    const store = await createStore();
    const { version } = await store.loadVersioned({ scope });
    const write = {
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      idempotencyKey: "key-1",
      expectedVersion: version,
    };

    await expect(store.append(write)).resolves.toMatchObject({ status: "committed" });
    await expect(store.append(write)).resolves.toMatchObject({ status: "duplicate" });
  });

  it("reports a conflict when a key is reused with different content", async () => {
    const store = await createStore();
    await store.append({
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      idempotencyKey: "key-1",
    });

    for (const changed of [
      { runId: "run-2", turn: 0, messages: [userMessage] },
      { runId: "run-1", turn: 1, messages: [userMessage] },
      { runId: "run-1", turn: 0, messages: [assistantMessage] },
    ]) {
      await expect(
        store.append({ scope, idempotencyKey: "key-1", ...changed }),
      ).resolves.toMatchObject({ status: "conflict" });
    }
    await expect(store.load({ scope })).resolves.toEqual([userMessage]);
  });

  it("accepts the current version and rejects a stale one without writing", async () => {
    const store = await createStore();
    const initial = await store.loadVersioned({ scope });
    expect(initial.messages).toEqual([]);

    const committed = await store.append({
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      expectedVersion: initial.version,
    });
    expect(committed.status).toBe("committed");

    const stale = await store.append({
      scope,
      runId: "run-2",
      turn: 0,
      messages: [assistantMessage],
      expectedVersion: initial.version,
    });
    expect(stale).toEqual({ status: "conflict", version: committed.version });
    await expect(store.load({ scope })).resolves.toEqual([userMessage]);

    await expect(
      store.append({
        scope,
        runId: "run-2",
        turn: 0,
        messages: [assistantMessage],
        expectedVersion: committed.version,
      }),
    ).resolves.toMatchObject({ status: "committed" });
  });

  it("returns a version from loadVersioned that matches the append result", async () => {
    const store = await createStore();
    const result = await store.append({
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      idempotencyKey: "key-1",
    });

    await expect(store.loadVersioned({ scope })).resolves.toEqual({
      messages: [userMessage],
      version: result.version,
    });
  });

  it("changes the version on append, clear and compaction, and never reuses one after clear", async () => {
    const store = await createStore();
    const empty = (await store.loadVersioned({ scope })).version;

    await store.append({ scope, runId: "run-1", turn: 0, messages: [userMessage] });
    const afterFirst = (await store.loadVersioned({ scope })).version;
    await store.append({ scope, runId: "run-1", turn: 1, messages: [assistantMessage] });
    const afterSecond = (await store.loadVersioned({ scope })).version;

    const snapshot = await store.compaction.snapshot({ scope });
    await store.compaction.replacePrefix({
      scope,
      revision: snapshot.revision,
      messageCount: 1,
      replacement: summary(),
      runId: "memory-compaction:1",
    });
    const afterCompaction = (await store.loadVersioned({ scope })).version;

    await store.clear({ scope });
    const afterClear = (await store.loadVersioned({ scope })).version;
    await store.append({ scope, runId: "run-1", turn: 0, messages: [userMessage] });
    const afterRecreate = (await store.loadVersioned({ scope })).version;

    const versions = [empty, afterFirst, afterSecond, afterCompaction, afterRecreate];
    expect(new Set(versions).size).toBe(versions.length);
    expect(afterClear).toBe(empty);
  });

  it("keeps idempotency keys across clear", async () => {
    const store = await createStore();
    const write = {
      scope,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
      idempotencyKey: "key-1",
    };
    await store.append(write);
    await store.clear({ scope });

    await expect(store.append(write)).resolves.toMatchObject({ status: "duplicate" });
    await expect(store.load({ scope })).resolves.toEqual([]);
  });

  it("scopes keys to the memory scope", async () => {
    const store = await createStore();
    const write = { runId: "run-1", turn: 0, messages: [userMessage], idempotencyKey: "key-1" };
    await store.append({ scope, ...write });

    await expect(
      store.append({ scope: { sessionId: "other-thread" }, ...write }),
    ).resolves.toMatchObject({ status: "committed" });
  });

  it("records the key of an empty keyed write so a repeat is a duplicate", async () => {
    const store = await createStore();
    const write = { scope, runId: "run-1", turn: 0, messages: [], idempotencyKey: "key-empty" };

    await expect(store.append(write)).resolves.toMatchObject({ status: "committed" });
    await expect(store.append(write)).resolves.toMatchObject({ status: "duplicate" });
    await expect(store.load({ scope })).resolves.toEqual([]);
  });

  it("commits exactly one of two interleaved writes that share an expected version", async () => {
    const path = sqlitePath();
    const first = await createStore({ path });
    const second = await createStore({ path, ensure: false });
    const { version } = await first.loadVersioned({ scope });

    const results = await Promise.all([
      first.append({
        scope,
        runId: "run-a",
        turn: 0,
        messages: [userMessage],
        idempotencyKey: "a",
        expectedVersion: version,
      }),
      second.append({
        scope,
        runId: "run-b",
        turn: 0,
        messages: [assistantMessage],
        idempotencyKey: "b",
        expectedVersion: version,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["committed", "conflict"]);
    await expect(first.load({ scope })).resolves.toHaveLength(1);
  });

  it("keeps plain appends unchanged", async () => {
    const store = await createStore();

    await store.append({ scope, runId: "run-1", turn: 0, messages: [userMessage] });
    await expect(store.append({ scope, runId: "run-1", turn: 1, messages: [] })).resolves.toEqual({
      status: "committed",
    });
    await store.append({ scope, runId: "run-1", turn: 1, messages: [assistantMessage] });

    await expect(store.load({ scope })).resolves.toEqual([userMessage, assistantMessage]);
  });

  it("keeps plain load and append working when the idempotency table is missing", async () => {
    const path = sqlitePath();
    const store = await createStore({ path });
    store.nativeDatabase().exec('DROP TABLE "anvia_memory_idempotency_keys"');

    await store.append({ scope, runId: "run-1", turn: 0, messages: [userMessage] });
    await expect(store.load({ scope })).resolves.toEqual([userMessage]);
    await expect(store.loadVersioned({ scope })).resolves.toMatchObject({
      messages: [userMessage],
    });
  });

  it("names the missing table when a keyed append cannot find it", async () => {
    const store = await createStore({ tableNames: { idempotencyKeys: "custom_keys" } });
    store.nativeDatabase().exec('DROP TABLE "custom_keys"');

    await expect(
      store.append({
        scope,
        runId: "run-1",
        turn: 0,
        messages: [userMessage],
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow("custom_keys");
    await expect(store.load({ scope })).resolves.toEqual([]);
  });

  it("creates the idempotency table in ensure() on an existing legacy schema", async () => {
    const store = await createStore();
    const database = store.nativeDatabase();
    database.exec('DROP TABLE "anvia_memory_idempotency_keys"');

    await store.ensure();

    await expect(
      store.append({
        scope,
        runId: "run-1",
        turn: 0,
        messages: [userMessage],
        idempotencyKey: "key-1",
      }),
    ).resolves.toMatchObject({ status: "committed" });
  });
});

function summary(): MemoryCompactionMessage {
  return {
    role: "system",
    content: "Earlier conversation summary",
    metadata: { anvia: { memoryCompaction: { version: 1, compactedMessageCount: 1 } } },
  };
}

type TestStore = SqliteMemoryStore & { nativeDatabase(): DatabaseSync };

async function createStore(
  options: SqliteMemoryStoreOptions & { path?: string; ensure?: boolean } = {},
): Promise<TestStore> {
  const { path = ":memory:", ensure = true, ...storeOptions } = options;
  const database = new DatabaseSync(path);
  databases.add(database);
  const store = new SqliteMemoryClient({ database }).memoryStore(storeOptions) as TestStore;
  store.nativeDatabase = () => database;
  if (ensure) await store.ensure();
  return store;
}

function sqlitePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "anvia-memory-sqlite-versioned-"));
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  return join(dir, "memory.sqlite");
}
