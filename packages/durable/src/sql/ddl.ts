/** Schema version the SQL stores read and write. New Postgres databases start here. */
export const SQL_SCHEMA_VERSION = 12;

/** Every table the SQL stores use, in creation order. */
export const SQL_TABLES = [
  "anvia_durable_owner",
  "anvia_durable_blobs",
  "anvia_durable_runs",
  "anvia_durable_run_summaries",
  "anvia_durable_graphs",
  "anvia_durable_operations",
  "anvia_durable_events",
  "anvia_durable_tasks",
  "anvia_durable_messages",
  "anvia_durable_histories",
] as const;

/**
 * Idempotent Postgres DDL. Ordering columns (`seq`, `sequence`) are BIGSERIAL and replace the SQLite
 * rowid; JSON fields that listings and the scheduler filter on are copied into typed columns
 * (`agent_id`, `graph_id`, `dependencies`, `next_attempt_at`, `outcome_type`, `started_at`).
 * Drizzle and Prisma users own an equivalent schema; see `@anvia/durable/drizzle` and `/prisma`.
 */
export const POSTGRES_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS anvia_durable_owner (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    version INTEGER NOT NULL,
    token TEXT,
    lease_expires_at TIMESTAMPTZ,
    host TEXT,
    pid INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_blobs (
    hash TEXT PRIMARY KEY, bytes BIGINT NOT NULL, record TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_runs (
    seq BIGSERIAL NOT NULL UNIQUE,
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    graph_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    next_attempt_at TEXT,
    outcome_type TEXT,
    dependencies JSONB,
    record TEXT NOT NULL,
    UNIQUE (session_id, request_id)
  )`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_run_session ON anvia_durable_runs (session_id, status)`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_run_agent_status ON anvia_durable_runs (agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_run_graph ON anvia_durable_runs (graph_id)`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_run_summaries (
    id TEXT PRIMARY KEY, record TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_graphs (
    seq BIGSERIAL NOT NULL UNIQUE,
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE (session_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_operations (
    seq BIGSERIAL NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    key TEXT NOT NULL,
    record TEXT NOT NULL,
    PRIMARY KEY (run_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_events (
    sequence BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    history_encoding TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_event_run ON anvia_durable_events (run_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_tasks (
    seq BIGSERIAL NOT NULL UNIQUE,
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL,
    ready_order BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE (session_id, parent_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_task_root ON anvia_durable_tasks (root_id)`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_task_parent ON anvia_durable_tasks (parent_id)`,
  `CREATE INDEX IF NOT EXISTS anvia_durable_task_status ON anvia_durable_tasks (status)`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_messages (
    hash TEXT PRIMARY KEY, record TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS anvia_durable_histories (
    hash TEXT PRIMARY KEY, previous TEXT, message TEXT NOT NULL
  )`,
];
