import { describe, expect, it, vi } from "vitest";
import { PrismaMemoryStore } from "../src/v8.js";

function model(rows: Record<string, unknown>[] = []) {
  const collection = {
    where: vi.fn(() => collection),
    select: vi.fn(() => collection),
    orderBy: vi.fn(() => collection),
    limit: vi.fn(() => collection),
    include: vi.fn(() => collection),
    all: vi.fn(async () => rows),
    first: vi.fn(async () => rows[0] ?? null),
    upsert: vi.fn(async () => ({ id: "session" })),
    create: vi.fn(async () => ({})),
    createAndCount: vi.fn(async () => 1),
    deleteAndCount: vi.fn(async () => 1),
  };
  return collection;
}

function fixture(rows: Record<string, unknown>[] = []) {
  const sessions = model(rows);
  const messages = model();
  const client = {
    orm: { public: { AgentMemorySession: sessions, AgentMemoryMessage: messages } },
    raw: { sql: vi.fn(() => ({ affectedCount: () => ({ build: () => ({}) }) })) },
    transaction: vi.fn(),
  };
  return { client, sessions, messages };
}

describe("Prisma 8 boundary", () => {
  it("rejects Prisma 7 clients and incomplete model contracts", () => {
    expect(() => new PrismaMemoryStore({ client: { $transaction() {} } })).toThrow(/Prisma 8/);
    const { client } = fixture();
    expect(() => new PrismaMemoryStore({ client, schema: "missing" })).toThrow(
      /client.orm.missing/,
    );
    expect(() => new PrismaMemoryStore({ client, models: { messages: "missing" } })).toThrow(
      /missing/,
    );
  });

  it.each(["Snapshot", "Serializable; DROP TABLE x", "", "serializable"])(
    "rejects unsupported isolation %j before any SQL",
    (isolationLevel) => {
      const { client } = fixture();
      expect(() => new PrismaMemoryStore({ client, transaction: { isolationLevel } })).toThrow(
        /Unsupported/,
      );
      expect(client.raw.sql).not.toHaveBeenCalled();
      expect(client.transaction).not.toHaveBeenCalled();
    },
  );

  it("requires the error model only when failed-run storage is enabled", async () => {
    const { client } = fixture();
    await expect(new PrismaMemoryStore({ client }).validate()).rejects.toThrow(/errors delegate/);
    await expect(
      new PrismaMemoryStore({ client, errorPolicy: "ignore", models: { errors: null } }).validate(),
    ).resolves.toBeUndefined();
  });

  it.each([
    "2024-01-02 03:04:05.678",
    "2024-01-02T03:04:05.678Z",
    "2024-01-02T10:04:05.678+07:00",
    new Date("2024-01-02T03:04:05.678Z"),
    { toString: () => "2024-01-02T03:04:05.678" },
  ])("normalizes timestamps and relation counts for inspection", async (timestamp) => {
    const { client } = fixture([
      {
        id: "session",
        sessionId: "thread",
        userId: null,
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: 3,
      },
    ]);
    const store = new PrismaMemoryStore({ client, errorPolicy: "ignore" });
    expect(await store.inspector!.listConversations({ limit: 1 })).toEqual([
      {
        ref: "session",
        sessionId: "thread",
        metadata: {},
        messageCount: 3,
        createdAt: "2024-01-02T03:04:05.678Z",
        updatedAt: "2024-01-02T03:04:05.678Z",
      },
    ]);
  });

  it("rejects malformed timestamps instead of returning invalid inspection data", async () => {
    const { client } = fixture([{ createdAt: "invalid" }]);
    const store = new PrismaMemoryStore({ client });
    await expect(store.inspector!.listConversations({ limit: 1 })).rejects.toThrow(
      /invalid timestamp/,
    );
  });

  describe("idempotency ledger", () => {
    const scope = { sessionId: "thread" };
    const input = {
      scope,
      runId: "run",
      turn: 1,
      messages: [{ role: "user" as const, content: "hi" }],
      idempotencyKey: "k1",
    };

    function transactional(withWrites: boolean, ledger: Record<string, unknown>[] = []) {
      const { client, sessions, messages } = fixture([{ id: "session", compactionState: null }]);
      const writes = model(ledger);
      const models: Record<string, unknown> = {
        AgentMemorySession: sessions,
        AgentMemoryMessage: messages,
      };
      if (withWrites) models.AgentMemoryWrite = writes;
      const orm = { public: models };
      Object.assign(client, { orm });
      client.transaction.mockImplementation(async (operation: (tx: unknown) => unknown) =>
        operation({ orm, execute: vi.fn() }),
      );
      return { client, writes, messages };
    }

    it("names the write model when the contract lacks it", async () => {
      const { client } = transactional(false);
      await expect(new PrismaMemoryStore({ client }).append(input)).rejects.toThrow(
        /AgentMemoryWrite/,
      );
    });

    it("records a new key and reports a matching stored fingerprint as a duplicate", async () => {
      const { client, writes, messages } = transactional(true);
      const store = new PrismaMemoryStore({ client });
      expect((await store.append(input)).status).toBe("committed");
      expect(writes.create).toHaveBeenCalledWith(
        expect.objectContaining({ scopeKey: expect.any(String), idempotencyKey: "k1" }),
      );
      expect(messages.createAndCount).toHaveBeenCalledTimes(1);

      const fingerprint = (writes.create.mock.calls[0] as unknown as [{ fingerprint: string }])[0]
        .fingerprint;
      const replay = transactional(true, [{ fingerprint }]);
      const result = await new PrismaMemoryStore({ client: replay.client }).append(input);
      expect(result.status).toBe("duplicate");
      expect(replay.messages.createAndCount).not.toHaveBeenCalled();
    });

    it("lets plain appends work when the contract lacks the write model", async () => {
      const { client, messages } = transactional(false);
      const result = await new PrismaMemoryStore({ client }).append({
        ...input,
        idempotencyKey: undefined,
      });
      expect(result.status).toBe("committed");
      expect(messages.createAndCount).toHaveBeenCalledTimes(1);
    });
  });
});
