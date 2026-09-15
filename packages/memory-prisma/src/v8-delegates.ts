import type { PrismaMemoryDelegates } from "./types.js";
import type { PrismaMemoryStoreOptions } from "./v8.js";

type Row = Record<string, unknown>;
type Field = {
  gte(value: number): unknown;
  in(values: unknown[]): unknown;
  asc(): unknown;
  desc(): unknown;
};
type Fields = Record<string, Field>;
type Order = (fields: Fields) => unknown;

// A private structural boundary: only the Prisma 8 operations used by our store.
// No generated application contract or Prisma 7 runtime leaks into this entrypoint.
type Collection = {
  where(filter: Row | ((fields: Fields) => unknown)): Collection;
  select(...fields: string[]): Collection;
  orderBy(order: Order[]): Collection;
  limit(count: number): Collection;
  include(relation: string, refine: (rows: { count(): unknown }) => unknown): Collection;
  all(): PromiseLike<Row[]>;
  first(): PromiseLike<Row | null>;
  upsert(args: { create: Row; update: Row; conflictOn: Row }): PromiseLike<Row>;
  create(data: Row): PromiseLike<Row>;
  createAndCount(data: Row[]): PromiseLike<number>;
  deleteAndCount(): PromiseLike<number>;
};
type RawStatement = { affectedCount(): { build(): unknown } };
type Client = {
  orm: Record<string, Record<string, Collection>>;
  raw: { sql(strings: TemplateStringsArray): RawStatement };
  transaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T>;
};
type Transaction = Pick<Client, "orm"> & { execute(plan: unknown): PromiseLike<unknown> };

// These inputs are produced exclusively by store.ts, never supplied by callers.
type QueryArgs = {
  where?: Row;
  select?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[];
  take?: number;
};
type UpsertArgs = { where: Row; create: Row; update: Row };

export function prisma8Delegates(options: PrismaMemoryStoreOptions): PrismaMemoryDelegates {
  const candidate = record(options.client, "client");
  if (
    typeof candidate.transaction !== "function" ||
    typeof record(candidate.raw, "client.raw").sql !== "function"
  ) {
    throw new TypeError(
      "Prisma 8 memory requires a PostgreSQL client with transaction() and raw.sql.",
    );
  }
  const client = options.client as Client;
  // Reject invalid caller options before issuing any query, including on empty appends.
  isolationPlan(client, options.transaction?.isolationLevel);
  const names = {
    sessions: options.models?.sessions ?? "AgentMemorySession",
    messages: options.models?.messages ?? "AgentMemoryMessage",
    errors: options.models?.errors === null ? null : (options.models?.errors ?? "AgentMemoryError"),
  };
  const schema = options.schema ?? "public";

  function bind(source: Pick<Client, "orm">): PrismaMemoryDelegates {
    const namespace = record(record(source.orm, "client.orm")[schema], `client.orm.${schema}`);
    const sessions = collection(namespace[names.sessions], names.sessions);
    const messages = collection(namespace[names.messages], names.messages);
    const errors =
      names.errors === null || namespace[names.errors] === undefined
        ? undefined
        : collection(namespace[names.errors], names.errors);

    function sessionQuery(args: QueryArgs): Collection {
      let query = refine(sessions, args);
      if (args.select?._count !== undefined) {
        query = query.include("messages", (rows) => rows.count());
      }
      return query;
    }

    async function messageQuery(args: QueryArgs): Promise<Collection> {
      const where = { ...args.where };
      const scopeFilter = where.memorySession;
      delete where.memorySession;
      let query = messages;
      if (scopeFilter !== undefined) {
        const session = await sessions
          .where(record(scopeFilter, "session filter"))
          .select("id")
          .first();
        query = query.where((fields) =>
          fields.memorySessionId!.in(session === null ? [] : [session.id]),
        );
      }
      return refine(query, { ...args, where });
    }

    const delegates: PrismaMemoryDelegates = {
      sessions: {
        async upsert(input) {
          const args = input as UpsertArgs;
          // timestamp(3) has no zone. Prisma 7 stores UTC in these columns.
          const updatedAt = new Date().toISOString().slice(0, -1);
          const row = await sessions.select("id").upsert({
            conflictOn: args.where,
            create: { ...args.create, updatedAt },
            update: { ...args.update, updatedAt },
          });
          if (typeof row.id !== "string")
            throw new TypeError("Prisma 8 memory session id must be a string.");
          return { id: row.id };
        },
        async deleteMany(input) {
          return { count: await refine(sessions, input as QueryArgs).deleteAndCount() };
        },
        async findMany(input) {
          return (await sessionQuery(input as QueryArgs).all()).map(normalizeRow);
        },
        async findUnique(input) {
          const row = await sessionQuery(input as QueryArgs).first();
          return row === null ? null : normalizeRow(row);
        },
      },
      messages: {
        async findMany(input) {
          const rows = await (await messageQuery(input as QueryArgs)).all();
          return rows.map((row) => ({ ...normalizeRow(row), message: row.message }));
        },
        async findFirst(input) {
          const row = await (await messageQuery(input as QueryArgs)).first();
          if (row === null) return null;
          if (!Number.isSafeInteger(row.position))
            throw new TypeError("Prisma 8 memory position must be an integer.");
          return { position: row.position as number };
        },
        async createMany(input) {
          return { count: await messages.createAndCount((input as { data: Row[] }).data) };
        },
      },
      errors:
        errors === undefined
          ? undefined
          : {
              async create(input) {
                return errors.create((input as { data: Row }).data);
              },
            },
      // The shared store never opens nested transactions. All delegates rebound
      // inside this callback use tx.orm, including inspection/compaction reads.
      transaction: async (operation, transactionOptions) => {
        const plan = isolationPlan(client, transactionOptions?.isolationLevel);
        return client.transaction(async (tx) => {
          if (plan !== undefined) await tx.execute(plan);
          return operation(bind(tx));
        });
      },
    };
    return delegates;
  }

  return bind(client);
}

function refine(collection: Collection, args: QueryArgs): Collection {
  let query = collection;
  const where = { ...args.where };
  const position = where.position;
  if (typeof position === "object" && position !== null) {
    delete where.position;
    const gte = (position as { gte: number }).gte;
    query = query.where((fields) => fields.position!.gte(gte));
  }
  if (Object.keys(where).length > 0) query = query.where(where);
  if (args.select !== undefined) {
    const fields = Object.keys(args.select).filter((key) => args.select?.[key] === true);
    if (fields.length > 0) query = query.select(...fields);
  }
  if (args.orderBy !== undefined) {
    const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
    query = query.orderBy(
      orders.flatMap((order) =>
        Object.entries(order).map(
          ([field, direction]) =>
            (fields: Fields) =>
              fields[field]![direction](),
        ),
      ),
    );
  }
  if (args.take !== undefined) query = query.limit(args.take);
  return query;
}

function isolationPlan(client: Client, level: string | undefined): unknown {
  switch (level) {
    case undefined:
      return undefined;
    case "ReadUncommitted":
      return client.raw.sql`SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`
        .affectedCount()
        .build();
    case "ReadCommitted":
      return client.raw.sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`.affectedCount().build();
    case "RepeatableRead":
      return client.raw.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`
        .affectedCount()
        .build();
    case "Serializable":
      return client.raw.sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`.affectedCount().build();
    default:
      throw new TypeError(`Unsupported Prisma 8 PostgreSQL isolation level: ${level}`);
  }
}

function record(value: unknown, name: string): Row {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`Prisma 8 memory expected ${name} to be an object.`);
  return value as Row;
}

function collection(value: unknown, name: string): Collection {
  const model = record(value, name);
  for (const method of [
    "where",
    "select",
    "all",
    "first",
    "upsert",
    "create",
    "createAndCount",
    "deleteAndCount",
  ]) {
    if (typeof model[method] !== "function")
      throw new TypeError(`Prisma 8 memory expected ${name}.${method}().`);
  }
  return value as Collection;
}

function normalizeRow(row: Row): Row {
  const result = { ...row };
  for (const field of ["createdAt", "updatedAt"]) {
    if (result[field] !== undefined) result[field] = utcTimestamp(result[field]);
  }
  if (typeof row.messages === "number") {
    result._count = { messages: row.messages };
    delete result.messages;
  }
  return result;
}

function utcTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  // Also accept Temporal values returned by inferred Timestamp/Timestamptz fields.
  if (typeof value === "object" && value !== null && typeof value.toString === "function")
    value = value.toString();
  if (typeof value !== "string")
    throw new TypeError("Prisma 8 memory received an invalid timestamp.");
  const normalized = value.replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("Prisma 8 memory received an invalid timestamp.");
  return date.toISOString();
}
