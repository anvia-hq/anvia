import type { JsonObject, MemoryStore, Message } from "@anvia/core";
import type {
  MemoryAppendOptions,
  MemoryCompactionCapability,
  MemoryCompactionReplacePrefixOptions,
  MemoryCompactionReplacePrefixResult,
  MemoryCompactionSnapshot,
  MemoryConversation,
  MemoryConversationListOptions,
  MemoryConversationSummary,
  MemoryErrorOptions,
  MemoryInspector,
  MemoryScope,
} from "@anvia/core/memory";
import { createMemoryScopeKey } from "@anvia/core/memory";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import type {
  PrismaMemoryClientLike,
  PrismaMemoryConventionalDelegates,
  PrismaMemoryDelegates,
  PrismaMemoryStoreOptions,
  PrismaMemoryTransactionOptions,
} from "./types.js";

type ResolvedPrismaMemoryStoreOptions = Required<
  Pick<PrismaMemoryStoreOptions, "errorPolicy" | "validateMessages">
> &
  Pick<PrismaMemoryStoreOptions, "scopeKey" | "transaction">;

type PrismaInspectionSessionRow = {
  id: string;
  sessionId: string;
  userId: string | null;
  metadata: JsonObject;
  createdAt: string | Date;
  updatedAt: string | Date;
  _count: { messages: number };
};

type PrismaInspectionMessageRow = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string | Date;
  message: unknown;
};

type PrismaCompactionMessageRow = {
  id: string;
  memorySessionId: string;
  position: number;
  message: unknown;
};

export class PrismaMemoryStore implements MemoryStore {
  readonly kind = "prisma";
  readonly inspector: MemoryInspector | undefined;
  readonly compaction: MemoryCompactionCapability | undefined;

  private readonly delegates: PrismaMemoryDelegates;
  private readonly options: ResolvedPrismaMemoryStoreOptions;

  constructor(options: PrismaMemoryStoreOptions) {
    this.delegates =
      options.delegates === undefined ? conventionalDelegates(options.client) : options.delegates;
    this.options = resolveOptions(options);
    const delegates = this.delegates;
    this.inspector = hasInspectionDelegates(delegates)
      ? {
          listConversations: (options) => this.listConversations(options),
          getConversation: ({ ref }) => this.getConversation(ref),
        }
      : undefined;
    this.compaction =
      typeof delegates.messages.deleteMany === "function"
        ? {
            snapshot: ({ scope }) => this.loadCompactionSnapshot(scope),
            replacePrefix: (options) => this.replaceCompactionPrefix(options),
          }
        : undefined;
  }

  async validate(): Promise<void> {
    await this.delegates.messages.findMany({
      where: { memorySession: { scopeKey: "__anvia_memory_validation__" } },
      orderBy: { position: "asc" },
      take: 1,
      select: {
        id: true,
        memorySessionId: true,
        runId: true,
        turn: true,
        position: true,
        role: true,
        message: true,
        createdAt: true,
      },
    });
    if (this.options.errorPolicy === "store" && this.delegates.errors === undefined) {
      throw new Error(
        'PrismaMemoryStore validation requires an errors delegate. Pass errorPolicy: "ignore" to disable failed-run storage.',
      );
    }
  }

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    const rows = await this.delegates.messages.findMany({
      where: { memorySession: { scopeKey: this.scopeKey(scope) } },
      orderBy: { position: "asc" },
      select: { message: true },
    });

    return rows.map((row) =>
      this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
    );
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    this.validateInputMessages(input.messages);

    await this.delegates.transaction(async (tx) => {
      const session = await upsertSession(tx, input.scope, this.scopeKey(input.scope));
      const last = await tx.messages.findFirst({
        where: { memorySessionId: session.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const start = (last?.position ?? -1) + 1;

      await tx.messages.createMany({
        data: input.messages.map((message, index) => ({
          memorySessionId: session.id,
          runId: input.runId,
          turn: input.turn,
          position: start + index,
          role: message.role,
          message,
        })),
      });
    }, this.options.transaction);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    await this.delegates.sessions.deleteMany({
      where: { scopeKey: this.scopeKey(scope) },
    });
  }

  async recordError(input: MemoryErrorOptions): Promise<void> {
    if (this.options.errorPolicy === "ignore") {
      return;
    }
    this.validateInputMessages(input.messages);
    if (this.delegates.errors === undefined) {
      throw new Error(
        'PrismaMemoryStore recordError requires an errors delegate. Pass errorPolicy: "ignore" to disable failed-run storage.',
      );
    }

    await this.delegates.transaction(async (tx) => {
      if (tx.errors === undefined) {
        throw new Error("PrismaMemoryStore transaction did not provide an errors delegate.");
      }

      const session = await upsertSession(tx, input.scope, this.scopeKey(input.scope));
      await tx.errors.create({
        data: {
          memorySessionId: session.id,
          runId: input.runId,
          error: serializeUnknownError(input.error),
          messages: input.messages,
        },
      });
    }, this.options.transaction);
  }

  private async loadCompactionSnapshot(context: MemoryScope): Promise<MemoryCompactionSnapshot> {
    const rows = (await this.delegates.messages.findMany({
      where: { memorySession: { scopeKey: this.scopeKey(context) } },
      orderBy: { position: "asc" },
      select: { id: true, memorySessionId: true, position: true, message: true },
    })) as PrismaCompactionMessageRow[];
    return {
      revision: compactionRevision(rows),
      messages: rows.map((row) =>
        this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
      ),
    };
  }

  private async replaceCompactionPrefix(
    input: MemoryCompactionReplacePrefixOptions,
  ): Promise<MemoryCompactionReplacePrefixResult> {
    this.validateInputMessages([input.replacement]);
    assertCompactionMessageCount(input.messageCount);

    try {
      return await this.delegates.transaction(async (tx) => {
        const rows = (await tx.messages.findMany({
          where: { memorySession: { scopeKey: this.scopeKey(input.scope) } },
          orderBy: { position: "asc" },
          select: { id: true, memorySessionId: true, position: true, message: true },
        })) as PrismaCompactionMessageRow[];
        if (compactionRevision(rows) !== input.revision || input.messageCount > rows.length) {
          return { status: "conflict" };
        }
        const boundary = rows[input.messageCount - 1];
        if (boundary === undefined) {
          return { status: "conflict" };
        }
        if (tx.messages.deleteMany === undefined) {
          throw new Error(
            "PrismaMemoryStore transaction did not provide a messages deleteMany delegate.",
          );
        }
        const deleted = await tx.messages.deleteMany({
          where: {
            id: {
              in: rows.slice(0, input.messageCount).map((row) => row.id),
            },
          },
        });
        if (deleted.count !== input.messageCount) {
          // Throw so Prisma rolls back the deleteMany before mapping to "conflict".
          throw new MemoryCompactionConflictAbort();
        }
        const session = await upsertSession(tx, input.scope, this.scopeKey(input.scope));
        await tx.messages.createMany({
          data: [
            {
              memorySessionId: session.id,
              runId: input.runId,
              turn: 0,
              position: boundary.position,
              role: input.replacement.role,
              message: input.replacement,
            },
          ],
        });
        return { status: "committed" };
      }, compactionTransactionOptions(this.options.transaction));
    } catch (error) {
      if (error instanceof MemoryCompactionConflictAbort) {
        return { status: "conflict" };
      }
      throw error;
    }
  }

  private async listConversations(
    options: MemoryConversationListOptions,
  ): Promise<MemoryConversationSummary[]> {
    const sessions = this.delegates.sessions;
    if (sessions.findMany === undefined) return [];
    const args: Record<string, unknown> = {
      take: options.limit,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: inspectionSessionSelect,
    };
    if (options.userId !== undefined) args.where = { userId: options.userId };
    const rows = (await sessions.findMany(args)) as PrismaInspectionSessionRow[];
    return rows.map(inspectionSummary);
  }

  private async getConversation(ref: string): Promise<MemoryConversation | undefined> {
    const sessions = this.delegates.sessions;
    if (sessions.findUnique === undefined) return undefined;
    const row = (await sessions.findUnique({
      where: { id: ref },
      select: inspectionSessionSelect,
    })) as PrismaInspectionSessionRow | null;
    if (row === null) return undefined;

    const messages = (await this.delegates.messages.findMany({
      where: { memorySessionId: ref },
      orderBy: { position: "asc" },
      select: {
        position: true,
        runId: true,
        turn: true,
        createdAt: true,
        message: true,
      },
    })) as PrismaInspectionMessageRow[];

    return {
      ...inspectionSummary(row),
      messages: messages.map((item) => ({
        position: item.position,
        runId: item.runId,
        turn: item.turn,
        createdAt: isoTimestamp(item.createdAt),
        message: this.options.validateMessages
          ? parseMemoryMessage(item.message)
          : (item.message as Message),
      })),
    };
  }

  private scopeKey(context: MemoryScope): string {
    if (typeof this.options.scopeKey === "function") {
      return this.options.scopeKey({ scope: context });
    }
    return createMemoryScopeKey({ scope: context, ...this.options.scopeKey });
  }

  private validateInputMessages(messages: Message[]): void {
    if (this.options.validateMessages) {
      for (const message of messages) {
        parseMemoryMessage(message);
      }
    }
  }
}

function resolveOptions(options: PrismaMemoryStoreOptions): ResolvedPrismaMemoryStoreOptions {
  return {
    scopeKey: options.scopeKey,
    errorPolicy: options.errorPolicy ?? "store",
    validateMessages: options.validateMessages ?? true,
    transaction: options.transaction,
  };
}

async function upsertSession(
  delegates: PrismaMemoryDelegates,
  context: MemoryScope,
  scopeKey: string,
): Promise<{ id: string }> {
  return delegates.sessions.upsert({
    where: { scopeKey },
    update: {
      sessionId: context.sessionId,
      userId: context.userId ?? null,
      metadata: metadata(context),
    },
    create: sessionCreateData(context, scopeKey),
    select: { id: true },
  });
}

function sessionCreateData(
  context: MemoryScope,
  scopeKey: string,
): { scopeKey: string; sessionId: string; userId?: string; metadata: JsonObject } {
  const data: { scopeKey: string; sessionId: string; userId?: string; metadata: JsonObject } = {
    scopeKey,
    sessionId: context.sessionId,
    metadata: metadata(context),
  };
  if (context.userId !== undefined) {
    data.userId = context.userId;
  }
  return data;
}

function metadata(context: MemoryScope): JsonObject {
  return context.metadata ?? {};
}

function conventionalDelegates(client: unknown): PrismaMemoryDelegates {
  assertConventionalClient(client);
  const models = conventionalModelDelegates(client);
  return {
    sessions: models.sessions,
    messages: models.messages,
    errors: models.errors,
    transaction: (operation, options) =>
      client.$transaction(
        async (tx) => operation(transactionDelegates(conventionalModelDelegates(tx))),
        options,
      ),
  };
}

function assertConventionalClient(client: unknown): asserts client is PrismaMemoryClientLike {
  if (!isRecord(client)) {
    throw new TypeError("PrismaMemoryStore expected a Prisma Client-like object.");
  }

  if (typeof client.$transaction !== "function") {
    throw new TypeError("PrismaMemoryStore expected client.$transaction to be a function.");
  }

  assertDelegate(client.agentMemorySession, "agentMemorySession", ["upsert", "deleteMany"]);
  assertDelegate(client.agentMemoryMessage, "agentMemoryMessage", [
    "findMany",
    "findFirst",
    "createMany",
  ]);

  if (client.agentMemoryError !== undefined) {
    assertDelegate(client.agentMemoryError, "agentMemoryError", ["create"]);
  }
}

function assertDelegate(delegate: unknown, name: string, methods: string[]): void {
  if (!isRecord(delegate)) {
    throw new TypeError(`PrismaMemoryStore expected client.${name} to be a delegate.`);
  }

  for (const method of methods) {
    if (typeof delegate[method] !== "function") {
      throw new TypeError(`PrismaMemoryStore expected client.${name}.${method} to be a function.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function conventionalModelDelegates(client: PrismaMemoryConventionalDelegates) {
  return {
    sessions: client.agentMemorySession,
    messages: client.agentMemoryMessage,
    errors: client.agentMemoryError,
  };
}

function transactionDelegates(
  models: Pick<PrismaMemoryDelegates, "sessions" | "messages" | "errors">,
): PrismaMemoryDelegates {
  let delegates: PrismaMemoryDelegates;
  delegates = {
    sessions: models.sessions,
    messages: models.messages,
    errors: models.errors,
    transaction: (operation) => operation(delegates),
  };
  return delegates;
}

const inspectionSessionSelect = {
  id: true,
  sessionId: true,
  userId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { messages: true } },
} as const;

function hasInspectionDelegates(delegates: PrismaMemoryDelegates): boolean {
  return (
    typeof delegates.sessions.findMany === "function" &&
    typeof delegates.sessions.findUnique === "function"
  );
}

function compactionRevision(rows: PrismaCompactionMessageRow[]): string {
  return JSON.stringify(rows.map((row) => row.id));
}

function compactionTransactionOptions(
  options: PrismaMemoryStoreOptions["transaction"],
): PrismaMemoryTransactionOptions {
  return {
    ...options,
    // Compaction is a read/check/delete/insert sequence without advisory locks.
    // Serializable prevents concurrent commits from both passing the revision check.
    isolationLevel: "Serializable",
  };
}

class MemoryCompactionConflictAbort extends Error {
  constructor() {
    super("Memory compaction conflict");
    this.name = "MemoryCompactionConflictAbort";
  }
}

function assertCompactionMessageCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("messageCount must be a positive integer.");
  }
}

function inspectionSummary(row: PrismaInspectionSessionRow): MemoryConversationSummary {
  const summary: MemoryConversationSummary = {
    ref: row.id,
    sessionId: row.sessionId,
    metadata: row.metadata,
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
    messageCount: row._count.messages,
  };
  if (row.userId !== null) summary.userId = row.userId;
  return summary;
}

function isoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
