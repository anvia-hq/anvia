import type { JsonObject, MemoryCompactionMessage, Message as MessageType } from "@anvia/core";
import { createMemoryScopeKey } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import * as memoryPrisma from "../src/index";
import {
  type PrismaMemoryClientLike,
  type PrismaMemoryDelegates,
  PrismaMemoryStore,
  type PrismaMemoryStoreOptions,
  type PrismaMemoryTransactionOptions,
} from "../src/index";
import { serializeUnknownError } from "../src/message";

// @ts-expect-error The positional store factory was removed.
const removedStoreFactory = memoryPrisma.createPrismaMemoryStore;
// @ts-expect-error Scope-key creation is canonical in @anvia/core/memory.
const removedScopeKeyFactory = memoryPrisma.createPrismaMemoryScopeKey;
void removedStoreFactory;
void removedScopeKeyFactory;

type SessionRow = {
  id: string;
  scopeKey: string;
  sessionId: string;
  userId?: string | undefined;
  metadata: JsonObject;
  compactionState?: unknown;
};

type MessageRow = {
  id: string;
  memorySessionId: string;
  runId: string;
  turn: number;
  position: number;
  role: MessageType["role"];
  message: unknown;
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

type ErrorRow = {
  memorySessionId: string;
  runId: string;
  error: unknown;
  messages: MessageType[];
};

type UpsertArgs = {
  where: { scopeKey: string };
  update: {
    sessionId: string;
    userId: string | null;
    metadata: JsonObject;
    compactionState?: unknown;
  };
  create: {
    scopeKey: string;
    sessionId: string;
    userId?: string | undefined;
    metadata: JsonObject;
    compactionState?: unknown;
  };
};

type DeleteManyArgs = {
  where: { scopeKey: string };
};

type FindManyArgs = {
  where:
    | { memorySession: { scopeKey: string } }
    | { memorySessionId: string; position?: { gte: number } };
};

type FindFirstArgs = {
  where: { memorySessionId: string };
};

type CreateManyArgs = {
  data: Array<Omit<MessageRow, "id">>;
};

type CreateErrorArgs = {
  data: ErrorRow;
};

type WriteRow = { scopeKey: string; idempotencyKey: string; fingerprint: string };

class FakePrisma {
  readonly writes: WriteRow[] = [];
  withWrites = true;
  readonly sessions = new Map<string, SessionRow>();
  readonly messages: MessageRow[] = [];
  readonly errors: ErrorRow[] = [];
  readonly transactionOptions: Array<PrismaMemoryTransactionOptions | undefined> = [];
  private nextSessionId = 1;
  private nextMessageId = 1;

  readonly agentMemorySession = {
    upsert: async (rawArgs: unknown) => {
      const args = rawArgs as UpsertArgs;
      const existing = this.sessions.get(args.where.scopeKey);
      if (existing !== undefined) {
        existing.sessionId = args.update.sessionId;
        existing.userId = args.update.userId ?? undefined;
        existing.metadata = args.update.metadata;
        if ("compactionState" in args.update) {
          existing.compactionState = args.update.compactionState;
        }
        return { id: existing.id };
      }

      const session: SessionRow = {
        id: `session_${this.nextSessionId}`,
        scopeKey: args.create.scopeKey,
        sessionId: args.create.sessionId,
        metadata: args.create.metadata,
      };
      if (args.create.userId !== undefined) {
        session.userId = args.create.userId;
      }
      if (args.create.compactionState !== undefined) {
        session.compactionState = args.create.compactionState;
      }
      this.nextSessionId += 1;
      this.sessions.set(args.where.scopeKey, session);
      return { id: session.id };
    },
    deleteMany: async (rawArgs: unknown) => {
      const args = rawArgs as DeleteManyArgs;
      const session = this.sessions.get(args.where.scopeKey);
      if (session === undefined) {
        return { count: 0 };
      }
      this.sessions.delete(args.where.scopeKey);
      removeWhere(this.messages, (message) => message.memorySessionId === session.id);
      removeWhere(this.errors, (error) => error.memorySessionId === session.id);
      return { count: 1 };
    },
    findMany: async (rawArgs: unknown) => {
      const args = rawArgs as {
        where?: { userId?: string };
        take: number;
      };
      return [...this.sessions.values()]
        .filter(
          (session) => args.where?.userId === undefined || session.userId === args.where.userId,
        )
        .slice(0, args.take)
        .map((session) => ({
          id: session.id,
          sessionId: session.sessionId,
          userId: session.userId ?? null,
          metadata: session.metadata,
          createdAt: new Date("2026-07-17T01:00:00.000Z"),
          updatedAt: new Date("2026-07-17T01:05:00.000Z"),
          _count: {
            messages: this.messages.filter((message) => message.memorySessionId === session.id)
              .length,
          },
        }));
    },
    findUnique: async (rawArgs: unknown) => {
      const args = rawArgs as { where: { id?: string; scopeKey?: string } };
      const session =
        args.where.scopeKey === undefined
          ? [...this.sessions.values()].find((item) => item.id === args.where.id)
          : this.sessions.get(args.where.scopeKey);
      if (session === undefined) return null;
      return {
        id: session.id,
        sessionId: session.sessionId,
        userId: session.userId ?? null,
        metadata: session.metadata,
        compactionState: session.compactionState ?? null,
        createdAt: new Date("2026-07-17T01:00:00.000Z"),
        updatedAt: new Date("2026-07-17T01:05:00.000Z"),
        _count: {
          messages: this.messages.filter((message) => message.memorySessionId === session.id)
            .length,
        },
      };
    },
  };

  readonly agentMemoryMessage = {
    findMany: async (rawArgs: unknown) => {
      const args = rawArgs as FindManyArgs;
      if ("memorySessionId" in args.where) {
        const { memorySessionId, position } = args.where;
        return this.messages
          .filter((message) => message.memorySessionId === memorySessionId)
          .filter((message) => position === undefined || message.position >= position.gte)
          .sort((left, right) => left.position - right.position)
          .map((message) => ({
            id: message.id,
            memorySessionId: message.memorySessionId,
            position: message.position,
            runId: message.runId,
            turn: message.turn,
            createdAt: new Date("2026-07-17T01:00:01.000Z"),
            message: message.message,
          }));
      }
      const session = this.sessions.get(args.where.memorySession.scopeKey);
      if (session === undefined) return [];
      return this.messages
        .filter((message) => message.memorySessionId === session.id)
        .sort((left, right) => left.position - right.position)
        .map((message) => ({ ...message }));
    },
    findFirst: async (rawArgs: unknown) => {
      const args = rawArgs as FindFirstArgs;
      const last = this.messages
        .filter((message) => message.memorySessionId === args.where.memorySessionId)
        .sort((left, right) => right.position - left.position)[0];
      return last === undefined ? null : { position: last.position };
    },
    createMany: async (rawArgs: unknown) => {
      const args = rawArgs as CreateManyArgs;
      this.messages.push(
        ...args.data.map((data) => ({
          ...data,
          id: `message_${this.nextMessageId++}`,
        })),
      );
      return { count: args.data.length };
    },
    deleteMany: async (rawArgs: unknown) => {
      const args = rawArgs as { where: { id: { in: string[] } } };
      const ids = new Set(args.where.id.in);
      const previousLength = this.messages.length;
      removeWhere(this.messages, (message) => ids.has(message.id));
      return { count: previousLength - this.messages.length };
    },
  };

  readonly agentMemoryError = {
    create: async (rawArgs: unknown) => {
      const args = rawArgs as CreateErrorArgs;
      this.errors.push(args.data);
      return args.data;
    },
  };

  readonly agentMemoryWrite = {
    findFirst: async (rawArgs: unknown) => {
      const { where } = rawArgs as { where: { scopeKey: string; idempotencyKey: string } };
      const row = this.writes.find(
        (item) => item.scopeKey === where.scopeKey && item.idempotencyKey === where.idempotencyKey,
      );
      return row === undefined ? null : { fingerprint: row.fingerprint };
    },
    create: async (rawArgs: unknown) => {
      const { data } = rawArgs as { data: WriteRow };
      if (
        this.writes.some(
          (item) => item.scopeKey === data.scopeKey && item.idempotencyKey === data.idempotencyKey,
        )
      ) {
        throw new Error("Unique constraint failed on (scopeKey, idempotencyKey)");
      }
      this.writes.push({ ...data });
      return data;
    },
  };

  get client(): PrismaMemoryClientLike {
    return {
      agentMemorySession: this.agentMemorySession,
      agentMemoryMessage: this.agentMemoryMessage,
      agentMemoryError: this.agentMemoryError,
      agentMemoryWrite: this.withWrites ? this.agentMemoryWrite : undefined,
      $transaction: async (operation, options) => {
        this.transactionOptions.push(options);
        const snapshot = this.snapshotState();
        try {
          return await operation(this.client);
        } catch (error) {
          this.restoreState(snapshot);
          throw error;
        }
      },
    };
  }

  get delegates(): PrismaMemoryDelegates {
    return {
      sessions: this.agentMemorySession,
      messages: this.agentMemoryMessage,
      errors: this.agentMemoryError,
      writes: this.agentMemoryWrite,
      transaction: async (operation, options) => {
        this.transactionOptions.push(options);
        const snapshot = this.snapshotState();
        try {
          return await operation(this.delegates);
        } catch (error) {
          this.restoreState(snapshot);
          throw error;
        }
      },
    };
  }

  private snapshotState() {
    return {
      sessions: new Map(
        [...this.sessions.entries()].map(([key, session]) => [key, { ...session }]),
      ),
      messages: this.messages.map((message) => ({ ...message })),
      errors: this.errors.map((error) => ({ ...error })),
      writes: this.writes.map((write) => ({ ...write })),
      nextSessionId: this.nextSessionId,
      nextMessageId: this.nextMessageId,
    };
  }

  private restoreState(snapshot: ReturnType<FakePrisma["snapshotState"]>) {
    this.sessions.clear();
    for (const [key, session] of snapshot.sessions) {
      this.sessions.set(key, session);
    }
    this.messages.length = 0;
    this.messages.push(...snapshot.messages);
    this.errors.length = 0;
    this.errors.push(...snapshot.errors);
    this.writes.length = 0;
    this.writes.push(...snapshot.writes);
    this.nextSessionId = snapshot.nextSessionId;
    this.nextMessageId = snapshot.nextMessageId;
  }
}

describe("PrismaMemoryStore", () => {
  it("validates the configured read path without writing memory", async () => {
    const prisma = new FakePrisma();
    const store = new PrismaMemoryStore({ client: prisma.client });

    await expect(store.validate()).resolves.toBeUndefined();
    expect(prisma.sessions.size).toBe(0);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.errors).toHaveLength(0);
  });

  it("uses core strict JSON validation for message metadata", async () => {
    const invalidMessage: MessageType = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      metadata: { score: Number.NaN },
    };

    const store = createTestMemoryStore(new FakePrisma().client);
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

  it("appends and loads scoped messages in position order", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client, {
      scopeKey: { metadataKeys: ["tenantId"] },
      transaction: { isolationLevel: "Serializable" },
    });
    const context = {
      sessionId: "thread_123",
      userId: "user_456",
      metadata: { tenantId: "tenant_789" },
    };

    await store.append({
      scope: context,
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi"), Message.assistant("hello")],
    });
    await store.append({
      scope: context,
      runId: "run_2",
      turn: 1,
      messages: [Message.user("again")],
    });

    await expect(store.load({ scope: context })).resolves.toEqual([
      Message.user("hi"),
      Message.assistant("hello"),
      Message.user("again"),
    ]);
    expect(prisma.messages.map((message) => message.position)).toEqual([0, 1, 2]);
    expect([...prisma.sessions.keys()]).toEqual([
      JSON.stringify(["thread_123", "user_456", "tenant_789"]),
    ]);
    expect(prisma.transactionOptions).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
  });

  it("atomically compacts a prefix and rejects stale revisions", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const compaction = store.compaction;
    if (compaction === undefined) {
      throw new Error("Expected Prisma compaction capability");
    }
    const context = { sessionId: "thread-compaction", userId: "user-1" };
    await store.append({
      scope: context,
      runId: "run-1",
      turn: 1,
      messages: [Message.user("old"), Message.assistant("old answer")],
    });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 1,
      messages: [Message.user("recent")],
    });
    const stale = await compaction.snapshot({ scope: context });
    await store.append({
      scope: context,
      runId: "run-2",
      turn: 2,
      messages: [Message.assistant("recent answer")],
    });
    const replacement = memoryCompactionMessage("Earlier conversation summary", 2);

    await expect(
      compaction.replacePrefix({
        scope: context,
        revision: stale.revision,
        messageCount: 2,
        replacement,
        runId: "memory-compaction:1",
      }),
    ).resolves.toEqual({ status: "conflict" });

    const current = await compaction.snapshot({ scope: context });
    await expect(
      compaction.replacePrefix({
        scope: context,
        revision: current.revision,
        messageCount: 2,
        replacement,
        runId: "memory-compaction:2",
      }),
    ).resolves.toEqual({ status: "committed" });
    expect(prisma.transactionOptions.at(-1)).toEqual({ isolationLevel: "Serializable" });
    await expect(store.load({ scope: context })).resolves.toEqual([
      Message.user("old"),
      Message.assistant("old answer"),
      Message.user("recent"),
      Message.assistant("recent answer"),
    ]);
    await expect(compaction.snapshot({ scope: context })).resolves.toMatchObject({
      messages: [replacement, Message.user("recent"), Message.assistant("recent answer")],
    });

    const conversations = await store.inspector?.listConversations({ limit: 1 });
    const conversation = conversations?.[0];
    const inspected =
      conversation === undefined
        ? undefined
        : await store.inspector?.getConversation({ ref: conversation.ref });
    expect(inspected).toMatchObject({
      messageCount: 4,
      messages: [
        { position: 0, runId: "run-1", turn: 1, message: Message.user("old") },
        {
          position: 1,
          runId: "run-1",
          turn: 1,
          message: Message.assistant("old answer"),
        },
        { position: 2, runId: "run-2", turn: 1, message: Message.user("recent") },
        {
          position: 3,
          runId: "run-2",
          turn: 2,
          message: Message.assistant("recent answer"),
        },
      ],
    });
  });

  it("omits compaction when custom sessions cannot read checkpoint state", () => {
    const prisma = new FakePrisma();
    let delegates: PrismaMemoryDelegates;
    delegates = {
      sessions: {
        upsert: prisma.agentMemorySession.upsert,
        deleteMany: prisma.agentMemorySession.deleteMany,
      },
      messages: prisma.agentMemoryMessage,
      errors: prisma.agentMemoryError,
      transaction: async (operation) => operation(delegates),
    };

    expect(createTestMemoryStoreFromDelegates(delegates).compaction).toBeUndefined();
  });

  it("inspects conventional Prisma sessions when read delegates are available", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    await store.append({
      scope: {
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
      },
      runId: "run-1",
      turn: 3,
      messages: [Message.user("hi"), Message.assistant("hello")],
    });

    const conversations = await store.inspector?.listConversations({
      limit: 10,
      userId: "user-1",
    });
    expect(conversations).toEqual([
      {
        ref: "session_1",
        sessionId: "thread-1",
        userId: "user-1",
        metadata: { tenantId: "tenant-1" },
        createdAt: "2026-07-17T01:00:00.000Z",
        updatedAt: "2026-07-17T01:05:00.000Z",
        messageCount: 2,
      },
    ]);
    await expect(store.inspector?.getConversation({ ref: "session_1" })).resolves.toMatchObject({
      ref: "session_1",
      messages: [
        { position: 0, runId: "run-1", turn: 3, message: Message.user("hi") },
        { position: 1, runId: "run-1", turn: 3, message: Message.assistant("hello") },
      ],
    });
  });

  it("keeps custom delegates without discovery methods compatible", () => {
    const prisma = new FakePrisma();
    const delegates: PrismaMemoryDelegates = {
      sessions: {
        upsert: prisma.agentMemorySession.upsert,
        deleteMany: prisma.agentMemorySession.deleteMany,
      },
      messages: prisma.agentMemoryMessage,
      errors: prisma.agentMemoryError,
      transaction: async (operation) => operation(delegates),
    };

    expect(createTestMemoryStoreFromDelegates(delegates).inspector).toBeUndefined();
  });

  it("omits userId from session data when the context does not provide it", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

    await store.append({
      scope: { sessionId: "thread_without_user" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });

    const session = prisma.sessions.values().next().value;
    expect(session).toStrictEqual({
      id: "session_1",
      scopeKey: JSON.stringify(["thread_without_user", null]),
      sessionId: "thread_without_user",
      metadata: {},
    });
    expect(session).not.toHaveProperty("userId");
  });

  it("does not open a transaction for empty appends", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

    await store.append({
      scope: { sessionId: "thread_123" },
      runId: "run_1",
      turn: 1,
      messages: [],
    });

    expect(prisma.sessions.size).toBe(0);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.transactionOptions).toEqual([]);
  });

  it("clears a scoped session and cascades messages and errors", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const context = { sessionId: "thread_123" };

    await store.append({
      scope: context,
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });
    await store.recordError({
      scope: context,
      runId: "run_1",
      error: new Error("failed"),
      messages: [Message.user("hi")],
    });

    await store.clear({ scope: context });

    await expect(store.load({ scope: context })).resolves.toEqual([]);
    expect(prisma.sessions.size).toBe(0);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.errors).toHaveLength(0);
  });

  it("stores failed-run errors by default", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

    await store.recordError({
      scope: { sessionId: "thread_123" },
      runId: "run_1",
      error: new Error("boom"),
      messages: [Message.user("hi")],
    });

    expect(prisma.errors).toHaveLength(1);
    expect(prisma.errors[0]).toMatchObject({
      runId: "run_1",
      error: { name: "Error", message: "boom" },
      messages: [Message.user("hi")],
    });
  });

  it("can ignore failed-run errors", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client, { errorPolicy: "ignore" });

    await store.recordError({
      scope: { sessionId: "thread_123" },
      runId: "run_1",
      error: new Error("boom"),
      messages: [Message.user("hi")],
    });

    expect(prisma.errors).toHaveLength(0);
  });

  it("throws when failed-run storage is enabled but no errors delegate exists", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStoreFromDelegates({
      sessions: prisma.agentMemorySession,
      messages: prisma.agentMemoryMessage,
      transaction: async (operation) =>
        operation({
          sessions: prisma.agentMemorySession,
          messages: prisma.agentMemoryMessage,
          transaction: async (nested) =>
            nested({
              sessions: prisma.agentMemorySession,
              messages: prisma.agentMemoryMessage,
              transaction: async () => {
                throw new Error("Nested transactions are not supported.");
              },
            }),
        }),
    });

    await expect(
      store.recordError({
        scope: { sessionId: "thread_123" },
        runId: "run_1",
        error: new Error("boom"),
        messages: [Message.user("hi")],
      }),
    ).rejects.toThrow("requires an errors delegate");
  });

  it("rejects malformed stored messages by default", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const scopeKey = createMemoryScopeKey({ scope: { sessionId: "thread_123" } });
    const session = await prisma.agentMemorySession.upsert({
      where: { scopeKey },
      update: { metadata: {} },
      create: { scopeKey, sessionId: "thread_123", metadata: {} },
    });
    prisma.messages.push({
      id: "malformed_1",
      memorySessionId: session.id,
      runId: "run_1",
      turn: 1,
      position: 0,
      role: "user",
      message: { role: "bad", content: [] },
    });

    await expect(store.load({ scope: { sessionId: "thread_123" } })).rejects.toThrow(
      "valid Anvia Message",
    );
  });

  it("can bypass stored message validation", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client, { validateMessages: false });
    const scopeKey = createMemoryScopeKey({ scope: { sessionId: "thread_123" } });
    const malformed = { role: "bad", content: [] };
    const session = await prisma.agentMemorySession.upsert({
      where: { scopeKey },
      update: { metadata: {} },
      create: { scopeKey, sessionId: "thread_123", metadata: {} },
    });
    prisma.messages.push({
      id: "malformed_2",
      memorySessionId: session.id,
      runId: "run_1",
      turn: 1,
      position: 0,
      role: "user",
      message: malformed,
    });

    await expect(store.load({ scope: { sessionId: "thread_123" } })).resolves.toEqual([malformed]);
  });

  it("supports custom delegates", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStoreFromDelegates(prisma.delegates);

    await store.append({
      scope: { sessionId: "thread_123" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });

    await expect(store.load({ scope: { sessionId: "thread_123" } })).resolves.toEqual([
      Message.user("hi"),
    ]);
  });

  it("uses custom scope functions", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client, {
      scopeKey: ({ scope }) => String(scope.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      scope: {
        sessionId: "thread_123",
        userId: "user_123",
        metadata: { tenantId: "tenant_789" },
      },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });

    await store.append({
      scope: {
        sessionId: "other_thread",
        userId: "user_456",
        metadata: { tenantId: "tenant_789" },
      },
      runId: "run_2",
      turn: 2,
      messages: [Message.user("again")],
    });

    expect([...prisma.sessions.keys()]).toEqual(["tenant_789"]);
    expect(prisma.sessions.get("tenant_789")).toMatchObject({
      sessionId: "other_thread",
      userId: "user_456",
    });
    await expect(
      store.load({
        scope: { sessionId: "other_thread", metadata: { tenantId: "tenant_789" } },
      }),
    ).resolves.toEqual([Message.user("hi"), Message.user("again")]);
  });

  it("rejects removed Prisma construction paths at compile time", () => {
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      const prisma = new FakePrisma();
      // @ts-expect-error PrismaMemoryStore accepts one options object.
      new PrismaMemoryStore(prisma.client);
      // @ts-expect-error The fromDelegates compatibility constructor was removed.
      PrismaMemoryStore.fromDelegates(prisma.delegates);
      new PrismaMemoryStore({
        client: prisma.client,
        // @ts-expect-error Error storage uses errorPolicy.
        errors: "ignore",
      });
    }
  });
});

type PrismaTestStoreOptions = Omit<PrismaMemoryStoreOptions, "client" | "delegates">;

describe("PrismaMemoryStore versioned, idempotent appends", () => {
  const scope = { sessionId: "thread-versioned", userId: "user-1" };
  const base = { scope, runId: "run-1", turn: 1 };

  async function loadedVersion(store: PrismaMemoryStore): Promise<string> {
    const history = await store.loadVersioned?.({ scope });
    if (history === undefined) throw new Error("Expected loadVersioned");
    return history.version;
  }

  it("commits a keyed append, treats a repeat as a duplicate and a changed repeat as a conflict", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

    const first = await store.append({
      ...base,
      messages: [Message.user("hi")],
      idempotencyKey: "k1",
    });
    expect(first.status).toBe("committed");

    const repeat = await store.append({
      ...base,
      messages: [Message.user("hi")],
      idempotencyKey: "k1",
    });
    expect(repeat).toEqual({ status: "duplicate", version: first.version });

    const changed = await store.append({
      ...base,
      messages: [Message.user("different")],
      idempotencyKey: "k1",
    });
    expect(changed).toEqual({ status: "conflict", version: first.version });
    expect(prisma.messages).toHaveLength(1);
    expect(prisma.writes).toHaveLength(1);
  });

  it("checks the key before the version so a retry after success is a duplicate", async () => {
    const store = createTestMemoryStore(new FakePrisma().client);
    const before = await loadedVersion(store);
    const input = { ...base, messages: [Message.user("hi")], idempotencyKey: "k1" };

    expect((await store.append({ ...input, expectedVersion: before })).status).toBe("committed");
    const retry = await store.append({ ...input, expectedVersion: before });
    expect(retry.status).toBe("duplicate");
  });

  it("rejects a stale expected version and accepts the current one", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    await store.append({ ...base, messages: [Message.user("one")] });
    const stale = await loadedVersion(store);
    await store.append({ ...base, messages: [Message.user("two")] });
    const current = await loadedVersion(store);
    expect(current).not.toBe(stale);

    const rejected = await store.append({
      ...base,
      messages: [Message.user("three")],
      expectedVersion: stale,
    });
    expect(rejected).toEqual({ status: "conflict", version: current });
    expect(prisma.messages).toHaveLength(2);

    const accepted = await store.append({
      ...base,
      messages: [Message.user("three")],
      expectedVersion: current,
    });
    expect(accepted.status).toBe("committed");
    expect(accepted.version).toBe(await loadedVersion(store));
    expect(prisma.messages).toHaveLength(3);
  });

  it("does not record the key when the version check fails", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    await store.append({ ...base, messages: [Message.user("one")] });
    const result = await store.append({
      ...base,
      messages: [Message.user("two")],
      idempotencyKey: "k1",
      expectedVersion: "stale",
    });
    expect(result.status).toBe("conflict");
    expect(prisma.writes).toHaveLength(0);
    expect(prisma.messages).toHaveLength(1);
  });

  it("keeps the empty version when recordError creates a session, so a write is not a conflict", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const empty = await loadedVersion(store);

    await store.recordError({
      scope,
      runId: "failed-run",
      error: new Error("failed"),
      messages: [Message.user("hi")],
    });

    expect(await loadedVersion(store)).toBe(empty);
    const result = await store.append({
      ...base,
      messages: [Message.user("a")],
      expectedVersion: empty,
    });
    expect(result.status).toBe("committed");
  });

  it("changes the version on append, clear and compaction replacePrefix", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const empty = await loadedVersion(store);
    await store.append({ ...base, messages: [Message.user("a"), Message.assistant("b")] });
    const afterFirst = await loadedVersion(store);
    await store.append({ ...base, messages: [Message.user("c")] });
    const afterSecond = await loadedVersion(store);
    expect(new Set([empty, afterFirst, afterSecond]).size).toBe(3);

    const snapshot = await store.compaction!.snapshot({ scope });
    const replaced = await store.compaction!.replacePrefix({
      scope,
      runId: "run-compact",
      revision: snapshot.revision,
      messageCount: 2,
      replacement: memoryCompactionMessage("summary", 2),
    });
    expect(replaced.status).toBe("committed");
    const afterCompaction = await loadedVersion(store);
    expect(afterCompaction).not.toBe(afterSecond);

    await store.clear({ scope });
    expect(await loadedVersion(store)).toBe(empty);
    await store.append({ ...base, messages: [Message.user("a"), Message.assistant("b")] });
    const recreated = await loadedVersion(store);
    expect([afterFirst, afterSecond, afterCompaction]).not.toContain(recreated);
  });

  it("keeps idempotency keys across clear", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const input = { ...base, messages: [Message.user("hi")], idempotencyKey: "k1" };
    await store.append(input);
    await store.clear({ scope });

    expect(prisma.writes).toHaveLength(1);
    expect((await store.append(input)).status).toBe("duplicate");
    await expect(store.load({ scope })).resolves.toEqual([]);
  });

  it("scopes keys to the memory scope", async () => {
    const store = createTestMemoryStore(new FakePrisma().client);
    const input = { ...base, messages: [Message.user("hi")], idempotencyKey: "k1" };
    await store.append(input);
    const other = await store.append({ ...input, scope: { sessionId: "other", userId: "user-1" } });
    expect(other.status).toBe("committed");
  });

  it("records the key for an empty keyed append so a repeat is a duplicate", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const input = { ...base, messages: [], idempotencyKey: "empty" };

    expect((await store.append(input)).status).toBe("committed");
    expect(prisma.writes).toHaveLength(1);
    expect(prisma.sessions.size).toBe(0);
    expect((await store.append(input)).status).toBe("duplicate");
  });

  it("leaves plain appends and loads unchanged", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

    expect(await store.append({ ...base, messages: [Message.user("hi")] })).toEqual({
      status: "committed",
    });
    expect(await store.append({ ...base, messages: [] })).toEqual({ status: "committed" });
    expect(prisma.writes).toHaveLength(0);
    expect(prisma.messages.map((row) => row.position)).toEqual([0]);
    const versioned = await store.loadVersioned?.({ scope });
    expect(versioned?.messages).toEqual(await store.load({ scope }));
  });

  it("keeps plain load, append and validate working without the write model", async () => {
    const prisma = new FakePrisma();
    prisma.withWrites = false;
    const store = createTestMemoryStore(prisma.client);

    await expect(store.validate()).resolves.toBeUndefined();
    await store.append({ ...base, messages: [Message.user("hi")] });
    await expect(store.load({ scope })).resolves.toEqual([Message.user("hi")]);
  });

  it("names the missing model when a keyed append has no write delegate", async () => {
    const prisma = new FakePrisma();
    prisma.withWrites = false;
    const store = createTestMemoryStore(prisma.client);

    await expect(
      store.append({ ...base, messages: [Message.user("hi")], idempotencyKey: "k1" }),
    ).rejects.toThrow(/AgentMemoryWrite/);
    expect(prisma.messages).toHaveLength(0);
  });

  it("rolls back the messages when recording the key fails", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    // A concurrent writer committed the key after our lookup: the unique constraint rejects ours.
    const create = prisma.agentMemoryWrite.create;
    prisma.agentMemoryWrite.create = async (args: unknown) => {
      await create(args);
      return create(args);
    };

    await expect(
      store.append({ ...base, messages: [Message.user("hi")], idempotencyKey: "k1" }),
    ).rejects.toThrow(/Unique constraint/);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.writes).toHaveLength(0);
  });
});

function createTestMemoryStore(
  client: object,
  options: PrismaTestStoreOptions = {},
): PrismaMemoryStore {
  return new PrismaMemoryStore({ client, ...options });
}

function createTestMemoryStoreFromDelegates(
  delegates: PrismaMemoryDelegates,
  options: PrismaTestStoreOptions = {},
): PrismaMemoryStore {
  return new PrismaMemoryStore({ delegates, ...options });
}

function removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      items.splice(index, 1);
    }
  }
}
