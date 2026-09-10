import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import type { MemoryCompactionMessage, Message } from "@anvia/core";
import {
  createSqliteMemorySchemaSql,
  type SqliteMemoryDatabaseLike,
  SqliteMemoryClient,
} from "@anvia/memory-sqlite";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("@anvia/memory-sqlite under Bun", () => {
  it("loads a driver automatically and enforces foreign keys on managed databases", async () => {
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-memory-sqlite-"));
    tempDirectories.push(root);
    const client = new SqliteMemoryClient({ path: join(root, "managed.sqlite") });
    const store = client.memoryStore();

    // ensure() validates foreign-key enforcement, so succeeding here proves
    // the client provisioned a driver with the pragma enabled.
    await expect(store.ensure()).resolves.toBeUndefined();
    await expect(store.validate()).resolves.toBeUndefined();
    const database = await client.nativeClient();
    expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    await client.close();
  });

  it("accepts an injected bun:sqlite Database without casts", async () => {
    const { Database: BunDatabase } = await import("bun:sqlite");
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-memory-sqlite-"));
    tempDirectories.push(root);
    const path = join(root, "injected.sqlite");
    const context = { sessionId: "bun-injected", userId: "bun-user" };
    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
    };

    // Strict compile-time proof against Bun's real declarations (bun-types is
    // ambient in this workspace): the assignment below fails to typecheck if
    // the package's driver surface ever diverges from bun:sqlite again.
    const realBunDatabase: Database = BunDatabase.open(path);
    const injected: SqliteMemoryDatabaseLike = realBunDatabase;
    // The client constructor must accept the real driver type directly too.
    const client = new SqliteMemoryClient({ database: realBunDatabase });
    // Keep the interface-typed alias in use so the assignability proof is not
    // dead code, and reassert the caller-owned pragma duty.
    injected.exec("PRAGMA foreign_keys = ON");
    const store = client.memoryStore();
    await store.ensure();

    await store.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage],
    });
    await expect(store.load({ scope: context })).resolves.toEqual([userMessage]);
    await client.close();
  });

  it("provisions a file-backed store, round-trips messages, and reloads persisted history", async () => {
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-memory-sqlite-"));
    tempDirectories.push(root);
    const path = join(root, "nested", "memory.sqlite");
    const context = { sessionId: "bun-thread", userId: "bun-user" };
    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
    };
    const assistantMessage: Message = {
      role: "assistant",
      content: [{ type: "text", text: "stored" }],
    };

    expect(createSqliteMemorySchemaSql()).toContain("CREATE TABLE IF NOT EXISTS");

    const first = new SqliteMemoryClient({ path });
    const firstStore = first.memoryStore();
    await expect(firstStore.load({ scope: context })).rejects.toThrow("Call store.ensure() first");

    await firstStore.ensure();
    await firstStore.append({
      scope: context,
      runId: "run-1",
      turn: 0,
      messages: [userMessage, assistantMessage],
    });
    await firstStore.append({
      scope: context,
      runId: "run-1",
      turn: 1,
      messages: [userMessage],
    });

    expect(await firstStore.load({ scope: context })).toEqual([
      userMessage,
      assistantMessage,
      userMessage,
    ]);
    expect(await firstStore.load({ scope: { sessionId: "other-thread" } })).toEqual([]);

    await first.close();
    await expect(firstStore.load({ scope: context })).rejects.toThrow(
      "SqliteMemoryClient is closed",
    );

    const second = new SqliteMemoryClient({ path });
    expect(await second.memoryStore().load({ scope: context })).toEqual([
      userMessage,
      assistantMessage,
      userMessage,
    ]);
    await second.close();
  });

  it("commits compaction checkpoints, rejects stale revisions, and inspects conversations", async () => {
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-memory-sqlite-"));
    tempDirectories.push(root);
    const client = new SqliteMemoryClient({ path: join(root, "memory.sqlite") });
    const store = client.memoryStore();
    await store.ensure();
    const context = { sessionId: "bun-compaction", userId: "bun-user" };
    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
    };
    const assistantMessage: Message = {
      role: "assistant",
      content: [{ type: "text", text: "stored" }],
    };
    const followUp: Message = {
      role: "user",
      content: [{ type: "text", text: "and this" }],
    };
    const replacement = memoryCompactionMessage("Earlier conversation summary", 2);

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
      messages: [followUp],
    });
    const stale = await store.compaction.snapshot({ scope: context });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 2,
      messages: [assistantMessage],
    });

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
      followUp,
      assistantMessage,
    ]);
    await expect(store.compaction.snapshot({ scope: context })).resolves.toMatchObject({
      messages: [replacement, followUp, assistantMessage],
    });

    const [conversation] = await store.inspector.listConversations({ limit: 1 });
    const inspected =
      conversation === undefined
        ? undefined
        : await store.inspector.getConversation({ ref: conversation.ref });
    expect(inspected).toMatchObject({
      sessionId: "bun-compaction",
      userId: "bun-user",
      messageCount: 4,
      messages: [
        { position: 0, runId: "run-1", turn: 1, message: userMessage },
        { position: 1, runId: "run-1", turn: 1, message: assistantMessage },
        { position: 2, runId: "run-2", turn: 1, message: followUp },
        { position: 3, runId: "run-2", turn: 2, message: assistantMessage },
      ],
    });
    await client.close();
  });

  it("stores failed-run diagnostics and skips them under the ignore policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-memory-sqlite-"));
    tempDirectories.push(root);

    const storing = new SqliteMemoryClient({ path: join(root, "storing.sqlite") });
    const storingStore = storing.memoryStore();
    await storingStore.ensure();
    await storingStore.recordError({
      scope: { sessionId: "bun-errors" },
      runId: "run-1",
      error: new Error("failed under bun"),
      messages: [{ role: "user", content: [{ type: "text", text: "remember this" }] }],
    });
    const [conversation] = await storingStore.inspector.listConversations({ limit: 10 });
    expect(conversation).toMatchObject({ sessionId: "bun-errors", messageCount: 0 });
    await storing.close();

    const ignoring = new SqliteMemoryClient({ path: join(root, "ignored.sqlite") });
    const ignoringStore = ignoring.memoryStore({ errorPolicy: "ignore" });
    await ignoringStore.ensure();
    await ignoringStore.recordError({
      scope: { sessionId: "bun-ignored" },
      runId: "run-1",
      error: new Error("failed under bun"),
      messages: [],
    });
    expect(await ignoringStore.inspector.listConversations({ limit: 10 })).toEqual([]);
    await ignoring.close();
  });
});

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
