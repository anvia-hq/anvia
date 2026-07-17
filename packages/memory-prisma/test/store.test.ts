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
import { isMemoryMessage, serializeUnknownError } from "../src/message";

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
  where: { memorySession: { scopeKey: string } } | { memorySessionId: string };
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

const richMessages: MessageType[] = [
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
        scopeKey: args.create.scopeKey,
        sessionId: args.create.sessionId,
        metadata: args.create.metadata,
      };
      if (args.create.userId !== undefined) {
        session.userId = args.create.userId;
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
      const args = rawArgs as { where: { id: string } };
      const session = [...this.sessions.values()].find((item) => item.id === args.where.id);
      if (session === undefined) return null;
      return {
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
      };
    },
  };

  readonly agentMemoryMessage = {
    findMany: async (rawArgs: unknown) => {
      const args = rawArgs as FindManyArgs;
      if ("memorySessionId" in args.where) {
        const { memorySessionId } = args.where;
        return this.messages
          .filter((message) => message.memorySessionId === memorySessionId)
          .sort((left, right) => left.position - right.position)
          .map((message) => ({
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
    const store = createPrismaMemoryStore(new FakePrisma().client);
    await expect(
      store.append({
        context: { sessionId: "thread-invalid" },
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

  it("inspects conventional Prisma sessions when read delegates are available", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);
    await store.append({
      context: {
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
    await expect(store.inspector?.getConversation("session_1")).resolves.toMatchObject({
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

    expect(PrismaMemoryStore.fromDelegates(delegates).inspector).toBeUndefined();
  });

  it("omits userId from session data when the context does not provide it", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);

    await store.append({
      context: { sessionId: "thread_without_user" },
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
    const store = createPrismaMemoryStore(prisma.client);
    const context = { sessionId: "rich-thread", userId: "user-1" };

    await store.append({ context, runId: "run-rich", turn: 0, messages: richMessages });

    await expect(store.load(context)).resolves.toEqual(richMessages);
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

  it("serializes JSON and non-JSON failed-run diagnostics", async () => {
    const prisma = new FakePrisma();
    const store = createPrismaMemoryStore(prisma.client);

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

  it("keeps falsey metadata values and normalizes missing scope paths to null", () => {
    expect(
      createPrismaMemoryScopeKey(
        { sessionId: "thread_123", metadata: { count: 0, enabled: false } },
        { metadataKeys: ["count", "enabled", "missing.value"] },
      ),
    ).toBe(JSON.stringify(["thread_123", null, 0, false, null]));
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
