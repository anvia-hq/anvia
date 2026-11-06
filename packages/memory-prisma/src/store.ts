import { createHash } from "node:crypto";
import type { JsonObject, MemoryCompactionMessage, MemoryStore, Message } from "@anvia/core";
import type {
  MemoryAppendOptions,
  MemoryAppendResult,
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
  MemoryVersionedHistory,
} from "@anvia/core/memory";
import { createMemoryScopeKey, isMemoryCompactionMessage } from "@anvia/core/memory";
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

type PrismaCompactionSessionRow = {
  id: string;
  compactionState: unknown;
};

type StoredCompactionState = {
  version: 1;
  generation: number;
  summary: MemoryCompactionMessage;
  summarizedThroughPosition: number;
};

export class PrismaMemoryStore implements MemoryStore {
  readonly kind = "prisma";
  readonly inspector: MemoryInspector | undefined;
  readonly compaction: MemoryCompactionCapability | undefined;
  readonly loadVersioned?: (options: { scope: MemoryScope }) => Promise<MemoryVersionedHistory>;

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
      typeof delegates.sessions.findUnique === "function"
        ? {
            snapshot: ({ scope }) => this.loadCompactionSnapshot(scope),
            replacePrefix: (options) => this.replaceCompactionPrefix(options),
          }
        : undefined;
    // The version is built from the session row, so it needs the sessions findUnique delegate.
    if (typeof delegates.sessions.findUnique === "function") {
      this.loadVersioned = (options) => this.readVersioned(options.scope);
    }
  }

  async validate(): Promise<void> {
    await this.delegates.sessions.findUnique?.({
      where: { scopeKey: "__anvia_memory_validation__" },
      select: { id: true, compactionState: true },
    });
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

  async append(input: MemoryAppendOptions): Promise<MemoryAppendResult> {
    const keyed = input.idempotencyKey !== undefined;
    const versioned = keyed || input.expectedVersion !== undefined;
    if (input.messages.length === 0 && !keyed && input.expectedVersion === undefined) {
      return { status: "committed" };
    }
    this.validateInputMessages(input.messages);
    const scopeKey = this.scopeKey(input.scope);

    return this.delegates.transaction(async (tx): Promise<MemoryAppendResult> => {
      if (input.idempotencyKey !== undefined) {
        if (tx.writes === undefined) {
          throw new Error(
            "PrismaMemoryStore idempotencyKey requires the AgentMemoryWrite model. Add it to your Prisma schema and run a migration.",
          );
        }
        const committed = await tx.writes.findFirst({
          where: { scopeKey, idempotencyKey: input.idempotencyKey },
          select: { fingerprint: true },
        });
        // Checked before the version so a retry after success is a duplicate, not a conflict.
        if (committed !== null) {
          const status =
            committed.fingerprint === writeFingerprint(input) ? "duplicate" : "conflict";
          return { status, version: await currentVersion(tx, scopeKey) };
        }
      }

      if (versioned) {
        const current = await currentVersion(tx, scopeKey);
        if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
          return { status: "conflict", version: current };
        }
      }

      if (input.messages.length > 0) {
        const session = await upsertSession(tx, input.scope, scopeKey);
        const tail = await tx.messages.findFirst({
          where: { memorySessionId: session.id },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        const start = (tail?.position ?? -1) + 1;
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
      }

      if (input.idempotencyKey !== undefined) {
        // The unique (scopeKey, idempotencyKey) constraint backstops a concurrent writer that
        // passed the lookup above: its insert fails and the whole transaction rolls back.
        await tx.writes!.create({
          data: {
            scopeKey,
            idempotencyKey: input.idempotencyKey,
            fingerprint: writeFingerprint(input),
          },
        });
      }

      if (!versioned) return { status: "committed" };
      return { status: "committed", version: await currentVersion(tx, scopeKey) };
    }, this.options.transaction);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    await this.delegates.sessions.deleteMany({
      where: { scopeKey: this.scopeKey(scope) },
    });
  }

  private async readVersioned(scope: MemoryScope): Promise<MemoryVersionedHistory> {
    // Version first: a write that lands between the two reads makes the version stale, which
    // fails safe as a conflict, whereas the reverse order could hide a newer commit.
    const version = await currentVersion(this.delegates, this.scopeKey(scope));
    return { messages: await this.load({ scope }), version };
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
    const sessions = this.delegates.sessions;
    if (sessions.findUnique === undefined) {
      throw new Error("Prisma memory compaction requires a sessions findUnique delegate.");
    }
    const session = (await sessions.findUnique({
      where: { scopeKey: this.scopeKey(context) },
      select: { id: true, compactionState: true },
    })) as PrismaCompactionSessionRow | null;
    if (session === null) {
      return { revision: compactionRevision([], undefined), messages: [] };
    }
    const state = this.compactionStateFromValue(session.compactionState);
    const where: { memorySessionId: string; position?: { gte: number } } = {
      memorySessionId: session.id,
    };
    if (state !== undefined) {
      where.position = { gte: state.summarizedThroughPosition };
    }
    const rows = (await this.delegates.messages.findMany({
      where,
      orderBy: { position: "asc" },
      select: { id: true, memorySessionId: true, position: true, message: true },
    })) as PrismaCompactionMessageRow[];
    return {
      revision: compactionRevision(rows, state),
      messages: projectedMessages(rows, state, (row) =>
        this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
      ),
    };
  }

  private async replaceCompactionPrefix(
    input: MemoryCompactionReplacePrefixOptions,
  ): Promise<MemoryCompactionReplacePrefixResult> {
    this.validateInputMessages([input.replacement]);
    assertCompactionMessageCount(input.messageCount);

    return this.delegates.transaction(async (tx) => {
      if (tx.sessions.findUnique === undefined) {
        throw new Error(
          "Prisma memory compaction requires a transactional sessions findUnique delegate.",
        );
      }
      const scopeKey = this.scopeKey(input.scope);
      const session = (await tx.sessions.findUnique({
        where: { scopeKey },
        select: { id: true, compactionState: true },
      })) as PrismaCompactionSessionRow | null;
      if (session === null) return { status: "conflict" };
      const state = this.compactionStateFromValue(session.compactionState);
      const where: { memorySessionId: string; position?: { gte: number } } = {
        memorySessionId: session.id,
      };
      if (state !== undefined) {
        where.position = { gte: state.summarizedThroughPosition };
      }
      const rows = (await tx.messages.findMany({
        where,
        orderBy: { position: "asc" },
        select: { id: true, memorySessionId: true, position: true, message: true },
      })) as PrismaCompactionMessageRow[];
      const activeRows = activeCompactionRows(rows, state);
      const physicalPrefixCount = input.messageCount - (state === undefined ? 0 : 1);
      if (
        compactionRevision(rows, state) !== input.revision ||
        physicalPrefixCount < 0 ||
        physicalPrefixCount > activeRows.length
      ) {
        return { status: "conflict" };
      }
      const summarizedThroughPosition =
        physicalPrefixCount === 0
          ? state?.summarizedThroughPosition
          : activeRows[physicalPrefixCount - 1]?.position;
      if (summarizedThroughPosition === undefined) {
        return { status: "conflict" };
      }
      await upsertSession(tx, input.scope, scopeKey, {
        version: 1,
        generation: (state?.generation ?? 0) + 1,
        summary: input.replacement,
        summarizedThroughPosition,
      });
      return { status: "committed" };
    }, compactionTransactionOptions(this.options.transaction));
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

  private compactionStateFromValue(value: unknown): StoredCompactionState | undefined {
    if (value === null || value === undefined) return undefined;
    return parseCompactionState(value, (message) =>
      this.options.validateMessages ? parseMemoryMessage(message) : (message as Message),
    );
  }
}

/**
 * Version = session row id + last message position + compaction generation. Appends move the
 * position, compaction moves the generation, and `clear()` deletes the session so a recreated one
 * gets a new id and can never reproduce an earlier version. Without a session the version is the
 * fixed value "none", which equals the state of a scope that never held data.
 */
async function currentVersion(delegates: PrismaMemoryDelegates, scopeKey: string): Promise<string> {
  if (delegates.sessions.findUnique === undefined) {
    throw new Error("Prisma memory versioning requires a sessions findUnique delegate.");
  }
  const session = (await delegates.sessions.findUnique({
    where: { scopeKey },
    select: { id: true, compactionState: true },
  })) as PrismaCompactionSessionRow | null;
  if (session === null) return "none";
  const tail = await delegates.messages.findFirst({
    where: { memorySessionId: session.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return formatVersion(session.id, tail?.position ?? -1, generationOf(session.compactionState));
}

function formatVersion(sessionId: string, last: number, generation: number): string {
  return `${sessionId}:${last}:${generation}`;
}

function generationOf(state: unknown): number {
  if (typeof state === "object" && state !== null) {
    const generation = (state as { generation?: unknown }).generation;
    if (typeof generation === "number") return generation;
  }
  return 0;
}

function writeFingerprint(input: MemoryAppendOptions): string {
  return createHash("sha256")
    .update(JSON.stringify({ runId: input.runId, turn: input.turn, messages: input.messages }))
    .digest("hex");
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
  compactionState?: StoredCompactionState,
): Promise<{ id: string }> {
  const update: {
    sessionId: string;
    userId: string | null;
    metadata: JsonObject;
    compactionState?: StoredCompactionState;
  } = {
    sessionId: context.sessionId,
    userId: context.userId ?? null,
    metadata: metadata(context),
  };
  if (compactionState !== undefined) {
    update.compactionState = compactionState;
  }
  const create = sessionCreateData(context, scopeKey);
  if (compactionState !== undefined) {
    create.compactionState = compactionState;
  }
  return delegates.sessions.upsert({
    where: { scopeKey },
    update,
    create,
    select: { id: true },
  });
}

function sessionCreateData(
  context: MemoryScope,
  scopeKey: string,
): {
  scopeKey: string;
  sessionId: string;
  userId?: string;
  metadata: JsonObject;
  compactionState?: StoredCompactionState;
} {
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
    writes: models.writes,
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

  if (client.agentMemoryWrite !== undefined) {
    assertDelegate(client.agentMemoryWrite, "agentMemoryWrite", ["findFirst", "create"]);
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
    writes: client.agentMemoryWrite,
  };
}

function transactionDelegates(
  models: Pick<PrismaMemoryDelegates, "sessions" | "messages" | "errors" | "writes">,
): PrismaMemoryDelegates {
  let delegates: PrismaMemoryDelegates;
  delegates = {
    sessions: models.sessions,
    messages: models.messages,
    errors: models.errors,
    writes: models.writes,
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

function compactionRevision(
  rows: PrismaCompactionMessageRow[],
  state: StoredCompactionState | undefined,
): string {
  return JSON.stringify([state?.generation ?? 0, rows.map((row) => row.id)]);
}

function projectedMessages(
  rows: PrismaCompactionMessageRow[],
  state: StoredCompactionState | undefined,
  message: (row: PrismaCompactionMessageRow) => Message,
): Message[] {
  if (state === undefined) return rows.map(message);
  return [state.summary, ...activeCompactionRows(rows, state).map(message)];
}

function activeCompactionRows(
  rows: PrismaCompactionMessageRow[],
  state: StoredCompactionState | undefined,
): PrismaCompactionMessageRow[] {
  if (state === undefined) return rows;
  const boundaryIndex = rows.findIndex((row) => row.position === state.summarizedThroughPosition);
  if (boundaryIndex === -1) {
    throw new Error("Prisma memory compaction state boundary is invalid.");
  }
  return rows.slice(boundaryIndex + 1);
}

function parseCompactionState(
  value: unknown,
  parseMessage: (message: unknown) => Message,
): StoredCompactionState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Prisma memory compaction state must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !Number.isSafeInteger(record.summarizedThroughPosition) ||
    (record.summarizedThroughPosition as number) < 0
  ) {
    throw new Error("Prisma memory compaction state is invalid.");
  }
  const summary = parseMessage(record.summary);
  if (!isMemoryCompactionMessage(summary)) {
    throw new Error("Prisma memory compaction state summary is invalid.");
  }
  return {
    version: 1,
    generation: record.generation as number,
    summarizedThroughPosition: record.summarizedThroughPosition as number,
    summary,
  };
}

function compactionTransactionOptions(
  options: PrismaMemoryStoreOptions["transaction"],
): PrismaMemoryTransactionOptions {
  return {
    ...options,
    // Compaction reads messages and updates a checkpoint without advisory locks.
    // Serializable prevents concurrent commits from both passing the revision check.
    isolationLevel: "Serializable",
  };
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
