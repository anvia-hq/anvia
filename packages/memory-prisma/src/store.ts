import type { JsonObject, JsonValue, MemoryStore, Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { parseMemoryMessage, serializeUnknownError } from "./message.js";
import type {
  PrismaMemoryClientLike,
  PrismaMemoryConventionalDelegates,
  PrismaMemoryDelegates,
  PrismaMemoryScopeOptions,
  PrismaMemoryStoreOptions,
} from "./types.js";

const defaultScopeOptions: { includeUserId: boolean; metadataKeys: string[] } = {
  includeUserId: true,
  metadataKeys: [],
};

export function createPrismaMemoryStore(
  client: unknown,
  options: PrismaMemoryStoreOptions = {},
): PrismaMemoryStore {
  return PrismaMemoryStore.fromClient(client, options);
}

export function createPrismaMemoryScopeKey(
  context: MemoryContext,
  options: PrismaMemoryScopeOptions = {},
): string {
  const includeUserId = options.includeUserId ?? defaultScopeOptions.includeUserId;
  const metadataKeys = options.metadataKeys ?? defaultScopeOptions.metadataKeys;
  const values: JsonValue[] = [context.sessionId];

  if (includeUserId) {
    values.push(context.userId ?? null);
  }

  for (const key of metadataKeys) {
    values.push(metadataValue(context.metadata, key) ?? null);
  }

  return JSON.stringify(values);
}

export class PrismaMemoryStore implements MemoryStore {
  private constructor(
    private readonly delegates: PrismaMemoryDelegates,
    private readonly options: Required<
      Pick<PrismaMemoryStoreOptions, "errors" | "validateMessages">
    > &
      Pick<PrismaMemoryStoreOptions, "scope" | "transaction">,
  ) {}

  static fromClient(client: unknown, options: PrismaMemoryStoreOptions = {}): PrismaMemoryStore {
    return new PrismaMemoryStore(conventionalDelegates(client), resolveOptions(options));
  }

  static fromDelegates(
    delegates: PrismaMemoryDelegates,
    options: PrismaMemoryStoreOptions = {},
  ): PrismaMemoryStore {
    return new PrismaMemoryStore(delegates, resolveOptions(options));
  }

  async load(context: MemoryContext): Promise<Message[]> {
    const rows = await this.delegates.messages.findMany({
      where: { memorySession: { scopeKey: this.scopeKey(context) } },
      orderBy: { position: "asc" },
      select: { message: true },
    });

    return rows.map((row) =>
      this.options.validateMessages ? parseMemoryMessage(row.message) : (row.message as Message),
    );
  }

  async append(input: MemoryAppendInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    this.validateInputMessages(input.messages);

    await this.delegates.transaction(async (tx) => {
      const session = await upsertSession(tx, input.context, this.scopeKey(input.context));
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

  async clear(context: MemoryContext): Promise<void> {
    await this.delegates.sessions.deleteMany({
      where: { scopeKey: this.scopeKey(context) },
    });
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    if (this.options.errors === "ignore") {
      return;
    }
    this.validateInputMessages(input.messages);
    if (this.delegates.errors === undefined) {
      throw new Error(
        'PrismaMemoryStore recordError requires an errors delegate. Pass errors: "ignore" to disable failed-run storage.',
      );
    }

    await this.delegates.transaction(async (tx) => {
      if (tx.errors === undefined) {
        throw new Error("PrismaMemoryStore transaction did not provide an errors delegate.");
      }

      const session = await upsertSession(tx, input.context, this.scopeKey(input.context));
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

  private scopeKey(context: MemoryContext): string {
    if (typeof this.options.scope === "function") {
      return this.options.scope(context);
    }
    return createPrismaMemoryScopeKey(context, this.options.scope);
  }

  private validateInputMessages(messages: Message[]): void {
    if (this.options.validateMessages) {
      for (const message of messages) {
        parseMemoryMessage(message);
      }
    }
  }
}

function resolveOptions(options: PrismaMemoryStoreOptions): PrismaMemoryStore["options"] {
  return {
    scope: options.scope,
    errors: options.errors ?? "store",
    validateMessages: options.validateMessages ?? true,
    transaction: options.transaction,
  };
}

async function upsertSession(
  delegates: PrismaMemoryDelegates,
  context: MemoryContext,
  scopeKey: string,
): Promise<{ id: string }> {
  return delegates.sessions.upsert({
    where: { scopeKey },
    update: {
      metadata: metadata(context),
    },
    create: sessionCreateData(context, scopeKey),
    select: { id: true },
  });
}

function sessionCreateData(
  context: MemoryContext,
  scopeKey: string,
): {
  scopeKey: string;
  sessionId: string;
  userId?: string | undefined;
  metadata: JsonObject;
} {
  return {
    scopeKey,
    sessionId: context.sessionId,
    ...(context.userId === undefined ? {} : { userId: context.userId }),
    metadata: metadata(context),
  };
}

function metadata(context: MemoryContext): JsonObject {
  return context.metadata ?? {};
}

function metadataValue(metadata: JsonObject | undefined, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = metadata;
  for (const part of path.split(".")) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conventionalDelegates(client: unknown): PrismaMemoryDelegates {
  assertConventionalClient(client);
  const models = conventionalModelDelegates(client);
  return {
    ...models,
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
    ...models,
    transaction: (operation) => operation(delegates),
  };
  return delegates;
}
