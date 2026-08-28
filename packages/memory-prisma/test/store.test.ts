import type { JsonObject, MemoryCompactionMessage, Message as MessageType } from "@anvia/core";
import { createMemoryScopeKey } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { richMessages } from "../../core/test/helpers/rich-messages";
import * as memoryPrisma from "../src/index";
import {
  type PrismaMemoryClientLike,
  type PrismaMemoryDelegates,
  PrismaMemoryStore,
  type PrismaMemoryStoreOptions,
  type PrismaMemoryTransactionOptions,
} from "../src/index";
import { isMemoryMessage, serializeUnknownError } from "../src/message";

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

class FakePrisma {
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

  get client(): PrismaMemoryClientLike {
    return {
      agentMemorySession: this.agentMemorySession,
      agentMemoryMessage: this.agentMemoryMessage,
      agentMemoryError: this.agentMemoryError,
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
    const validMessage: MessageType = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      metadata: { score: 1 },
    };
    const invalidMessage: MessageType = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      metadata: { score: Number.NaN },
    };

    expect(isMemoryMessage(validMessage)).toBe(true);
    expect(isMemoryMessage(invalidMessage)).toBe(false);
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

  it("compacts without a messages deleteMany delegate", async () => {
    const prisma = new FakePrisma();
    const context = { sessionId: "thread-missing-delete", userId: "user-1" };
    const seed = createTestMemoryStore(prisma.client);
    await seed.append({
      scope: context,
      runId: "run-1",
      turn: 1,
      messages: [Message.user("old"), Message.assistant("old answer"), Message.user("recent")],
    });
    const snapshot = await seed.compaction?.snapshot({ scope: context });
    if (snapshot === undefined) {
      throw new Error("Expected Prisma compaction capability");
    }

    let delegates: PrismaMemoryDelegates;
    delegates = {
      sessions: prisma.agentMemorySession,
      messages: {
        findMany: prisma.agentMemoryMessage.findMany,
        findFirst: prisma.agentMemoryMessage.findFirst,
        createMany: prisma.agentMemoryMessage.createMany,
      },
      errors: prisma.agentMemoryError,
      transaction: async (operation, options) => {
        prisma.transactionOptions.push(options);
        return operation(delegates);
      },
    };
    const store = createTestMemoryStoreFromDelegates(delegates);
    const compaction = store.compaction;
    if (compaction === undefined) {
      throw new Error("Expected Prisma compaction capability");
    }

    await expect(
      compaction.replacePrefix({
        scope: context,
        revision: snapshot.revision,
        messageCount: 2,
        replacement: memoryCompactionMessage("summary", 2),
        runId: "memory-compaction:missing-delete",
      }),
    ).resolves.toEqual({ status: "committed" });
    await expect(store.load({ scope: context })).resolves.toEqual([
      Message.user("old"),
      Message.assistant("old answer"),
      Message.user("recent"),
    ]);
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

  it("round-trips every supported message content shape", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ scope: context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load({ scope: context })).resolves.toEqual(richMessages);
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

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const prisma = new FakePrisma();
    const store = createTestMemoryStore(prisma.client);

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

    expect(prisma.errors.map(({ runId, error, messages }) => ({ runId, error, messages }))).toEqual(
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

  it("creates scope keys from selected metadata", () => {
    expect(
      createMemoryScopeKey({
        scope: {
          sessionId: "thread_123",
          userId: "user_456",
          metadata: { tenant: { id: "tenant_789" } },
        },
        metadataKeys: ["tenant.id"],
      }),
    ).toBe(JSON.stringify(["thread_123", "user_456", "tenant_789"]));
  });

  it("keeps falsey metadata values and normalizes missing scope paths to null", () => {
    expect(
      createMemoryScopeKey({
        scope: { sessionId: "thread_123", metadata: { count: 0, enabled: false } },
        metadataKeys: ["count", "enabled", "missing.value"],
      }),
    ).toBe(JSON.stringify(["thread_123", null, 0, false, null]));
  });

  it("can omit user ids from generated scope keys", () => {
    expect(
      createMemoryScopeKey({
        scope: { sessionId: "thread_123", userId: "user_456" },
        includeUserId: false,
      }),
    ).toBe(JSON.stringify(["thread_123"]));
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
