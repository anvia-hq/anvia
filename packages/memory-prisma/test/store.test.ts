import type { JsonObject, Message as MessageType } from "@anvia/core";
import { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import {
  createPrismaMemoryScopeKey,
  createPrismaMemoryStore,
  type PrismaMemoryClientLike,
  type PrismaMemoryDelegates,
  PrismaMemoryStore,
  type PrismaMemoryTransactionOptions,
} from "../src/index";

type SessionRow = {
  id: string;
  scopeKey: string;
  sessionId: string;
  userId?: string | undefined;
  metadata: JsonObject;
};

type MessageRow = {
  memorySessionId: string;
  runId: string;
  turn: number;
  position: number;
  role: MessageType["role"];
  message: unknown;
};

type ErrorRow = {
  memorySessionId: string;
  runId: string;
  error: unknown;
  messages: MessageType[];
};

type UpsertArgs = {
  where: { scopeKey: string };
  update: { metadata: JsonObject };
  create: {
    scopeKey: string;
    sessionId: string;
    userId?: string | undefined;
    metadata: JsonObject;
  };
};

type DeleteManyArgs = {
  where: { scopeKey: string };
};

type FindManyArgs = {
  where: { memorySession: { scopeKey: string } };
};

type FindFirstArgs = {
  where: { memorySessionId: string };
};

type CreateManyArgs = {
  data: MessageRow[];
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

  readonly agentMemorySession = {
    upsert: async (rawArgs: unknown) => {
      const args = rawArgs as UpsertArgs;
      const existing = this.sessions.get(args.where.scopeKey);
      if (existing !== undefined) {
        existing.metadata = args.update.metadata;
        return { id: existing.id };
      }

      const session: SessionRow = {
        id: `session_${this.nextSessionId}`,
        ...args.create,
      };
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
  };

  readonly agentMemoryMessage = {
    findMany: async (rawArgs: unknown) => {
      const args = rawArgs as FindManyArgs;
      const session = this.sessions.get(args.where.memorySession.scopeKey);
      if (session === undefined) {
        return [];
      }
      return this.messages
        .filter((message) => message.memorySessionId === session.id)
        .sort((left, right) => left.position - right.position)
        .map((message) => ({ message: message.message }));
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
      this.messages.push(...args.data);
      return { count: args.data.length };
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
        return operation(this.client);
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
        return operation(this.delegates);
      },
    };
  }
}

describe("PrismaMemoryStore", () => {
  it("appends and loads scoped messages in position order", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client, {
      scope: { metadataKeys: ["tenantId"] },
      transaction: { isolationLevel: "Serializable" },
    });
    const context = {
      sessionId: "thread_123",
      userId: "user_456",
      metadata: { tenantId: "tenant_789" },
    };

    await store.append({
      context,
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi"), Message.assistant("hello")],
    });
    await store.append({
      context,
      runId: "run_2",
      turn: 1,
      messages: [Message.user("again")],
    });

    await expect(store.load(context)).resolves.toEqual([
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

  it("does not open a transaction for empty appends", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);

    await store.append({
      context: { sessionId: "thread_123" },
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
    const store = createPrismaMemoryStore(prisma.client);
    const context = { sessionId: "thread_123" };

    await store.append({
      context,
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });
    await store.recordError({
      context,
      runId: "run_1",
      error: new Error("failed"),
      messages: [Message.user("hi")],
    });

    await store.clear(context);

    await expect(store.load(context)).resolves.toEqual([]);
    expect(prisma.sessions.size).toBe(0);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.errors).toHaveLength(0);
  });

  it("stores failed-run errors by default", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);

    await store.recordError({
      context: { sessionId: "thread_123" },
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
    const store = createPrismaMemoryStore(prisma.client, { errors: "ignore" });

    await store.recordError({
      context: { sessionId: "thread_123" },
      runId: "run_1",
      error: new Error("boom"),
      messages: [Message.user("hi")],
    });

    expect(prisma.errors).toHaveLength(0);
  });

  it("throws when failed-run storage is enabled but no errors delegate exists", async () => {
    const prisma = new FakePrisma();
    const store = PrismaMemoryStore.fromDelegates({
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
        context: { sessionId: "thread_123" },
        runId: "run_1",
        error: new Error("boom"),
        messages: [Message.user("hi")],
      }),
    ).rejects.toThrow("requires an errors delegate");
  });

  it("rejects malformed stored messages by default", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);
    const scopeKey = createPrismaMemoryScopeKey({ sessionId: "thread_123" });
    const session = await prisma.agentMemorySession.upsert({
      where: { scopeKey },
      update: { metadata: {} },
      create: { scopeKey, sessionId: "thread_123", metadata: {} },
    });
    prisma.messages.push({
      memorySessionId: session.id,
      runId: "run_1",
      turn: 1,
      position: 0,
      role: "user",
      message: { role: "bad", content: [] },
    });

    await expect(store.load({ sessionId: "thread_123" })).rejects.toThrow("valid Anvia Message");
  });

  it("can bypass stored message validation", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client, { validateMessages: false });
    const scopeKey = createPrismaMemoryScopeKey({ sessionId: "thread_123" });
    const malformed = { role: "bad", content: [] };
    const session = await prisma.agentMemorySession.upsert({
      where: { scopeKey },
      update: { metadata: {} },
      create: { scopeKey, sessionId: "thread_123", metadata: {} },
    });
    prisma.messages.push({
      memorySessionId: session.id,
      runId: "run_1",
      turn: 1,
      position: 0,
      role: "user",
      message: malformed,
    });

    await expect(store.load({ sessionId: "thread_123" })).resolves.toEqual([malformed]);
  });

  it("supports custom delegates", async () => {
    const prisma = new FakePrisma();
    const store = PrismaMemoryStore.fromDelegates(prisma.delegates);

    await store.append({
      context: { sessionId: "thread_123" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });

    await expect(store.load({ sessionId: "thread_123" })).resolves.toEqual([Message.user("hi")]);
  });

  it("uses custom scope functions", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client, {
      scope: (context) => String(context.metadata?.tenantId ?? "unknown"),
    });

    await store.append({
      context: { sessionId: "thread_123", metadata: { tenantId: "tenant_789" } },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });

    expect([...prisma.sessions.keys()]).toEqual(["tenant_789"]);
    await expect(
      store.load({ sessionId: "other_thread", metadata: { tenantId: "tenant_789" } }),
    ).resolves.toEqual([Message.user("hi")]);
  });

  it("creates scope keys from selected metadata", () => {
    expect(
      createPrismaMemoryScopeKey(
        {
          sessionId: "thread_123",
          userId: "user_456",
          metadata: { tenant: { id: "tenant_789" } },
        },
        { metadataKeys: ["tenant.id"] },
      ),
    ).toBe(JSON.stringify(["thread_123", "user_456", "tenant_789"]));
  });

  it("can omit user ids from generated scope keys", () => {
    expect(
      createPrismaMemoryScopeKey(
        { sessionId: "thread_123", userId: "user_456" },
        { includeUserId: false },
      ),
    ).toBe(JSON.stringify(["thread_123"]));
  });
});

function removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      items.splice(index, 1);
    }
  }
}
