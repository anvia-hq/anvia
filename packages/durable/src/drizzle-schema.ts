import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Drizzle definitions of the tables the durable store uses. Re-export them from your own schema
 * (`anvia-durable-drizzle init` writes that file) so drizzle-kit creates and migrates them. The
 * store never creates or alters tables on a Drizzle database; it only verifies them on open.
 */
export const anviaDurableOwner = pgTable(
  "anvia_durable_owner",
  {
    singleton: integer("singleton").primaryKey(),
    version: integer("version").notNull(),
    token: text("token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    host: text("host"),
    pid: integer("pid"),
  },
  (table) => [check("anvia_durable_owner_singleton_check", sql`${table.singleton} = 1`)],
);

export const anviaDurableBlobs = pgTable("anvia_durable_blobs", {
  hash: text("hash").primaryKey(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  record: text("record").notNull(),
});

export const anviaDurableRuns = pgTable(
  "anvia_durable_runs",
  {
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    status: text("status").notNull(),
    agentId: text("agent_id").notNull(),
    graphId: text("graph_id"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    nextAttemptAt: text("next_attempt_at"),
    outcomeType: text("outcome_type"),
    dependencies: jsonb("dependencies"),
    record: text("record").notNull(),
  },
  (table) => [
    unique("anvia_durable_runs_session_id_request_id_key").on(table.sessionId, table.requestId),
    index("anvia_durable_run_session").on(table.sessionId, table.status),
    index("anvia_durable_run_agent_status").on(table.agentId, table.status),
    index("anvia_durable_run_graph").on(table.graphId),
  ],
);

export const anviaDurableRunSummaries = pgTable("anvia_durable_run_summaries", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
});

export const anviaDurableGraphs = pgTable(
  "anvia_durable_graphs",
  {
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: text("created_at").notNull(),
    record: text("record").notNull(),
  },
  (table) => [
    unique("anvia_durable_graphs_session_id_request_id_key").on(table.sessionId, table.requestId),
  ],
);

export const anviaDurableOperations = pgTable(
  "anvia_durable_operations",
  {
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    runId: text("run_id").notNull(),
    key: text("key").notNull(),
    record: text("record").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.key] })],
);

export const anviaDurableEvents = pgTable(
  "anvia_durable_events",
  {
    sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
    runId: text("run_id").notNull(),
    createdAt: text("created_at").notNull(),
    type: text("type").notNull(),
    data: text("data").notNull(),
    historyEncoding: text("history_encoding"),
  },
  (table) => [index("anvia_durable_event_run").on(table.runId, table.sequence)],
);

export const anviaDurableTasks = pgTable(
  "anvia_durable_tasks",
  {
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    id: text("id").primaryKey(),
    rootId: text("root_id").notNull(),
    parentId: text("parent_id").notNull(),
    sessionId: text("session_id").notNull(),
    key: text("key").notNull(),
    status: text("status").notNull(),
    readyOrder: bigint("ready_order", { mode: "number" }).notNull(),
    createdAt: text("created_at").notNull(),
    record: text("record").notNull(),
  },
  (table) => [
    unique("anvia_durable_tasks_session_id_parent_id_key_key").on(
      table.sessionId,
      table.parentId,
      table.key,
    ),
    index("anvia_durable_task_root").on(table.rootId),
    index("anvia_durable_task_parent").on(table.parentId),
    index("anvia_durable_task_status").on(table.status),
  ],
);

export const anviaDurableMessages = pgTable("anvia_durable_messages", {
  hash: text("hash").primaryKey(),
  record: text("record").notNull(),
});

export const anviaDurableHistories = pgTable("anvia_durable_histories", {
  hash: text("hash").primaryKey(),
  previous: text("previous"),
  message: text("message").notNull(),
});

/** Every table, for tooling that needs the full list. */
export const anviaDurableTables = {
  anviaDurableOwner,
  anviaDurableBlobs,
  anviaDurableRuns,
  anviaDurableRunSummaries,
  anviaDurableGraphs,
  anviaDurableOperations,
  anviaDurableEvents,
  anviaDurableTasks,
  anviaDurableMessages,
  anviaDurableHistories,
} as const;

export const drizzleDurableExportNames = Object.keys(anviaDurableTables) as ReadonlyArray<
  keyof typeof anviaDurableTables
>;
