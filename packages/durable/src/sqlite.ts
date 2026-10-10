import { messageLog, messageLogTables } from "./message-log.js";
import { sqliteMetrics } from "./metrics.js";
import { graphListSchema, parseGraphRecord } from "./graph-schema.js";
import {
  taskTables,
  taskTransaction,
  listTasks,
  scheduleTasks,
  unsettledTaskRoots,
} from "./tasks/sqlite.js";
import type { TaskListOptions } from "./tasks/types.js";
import type { DurableGraphListOptions, DurableGraphPage } from "./graph-types.js";
import { hostname } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { json, nonblank } from "./json.js";
import {
  eventTypeSchema,
  listOptionsSchema,
  parseOperation,
  parseRun,
  parseRunSummary,
} from "./schema.js";
import type {
  DurableEvent,
  DurableListOptions,
  DurableRunPage,
  DurableRunRecord,
  DurableRunSummary,
  DurableStore,
  DurableTransaction,
} from "./types.js";

/** SQLite storage for one host and one runtime owner. Use a dedicated local database file. */
export class SqliteDurableStore implements DurableStore {
  private readonly database: DatabaseSync;
  private readonly histories: ReturnType<typeof messageLog>;
  private readonly token = globalThis.crypto.randomUUID();
  private acquired = false;
  private closed = false;
  private inTransaction = false;

  constructor(path: string) {
    nonblank(path, "SQLite path");
    this.database = new DatabaseSync(path);
    try {
      if (
        this.database
          .prepare("SELECT 1 FROM sqlite_master WHERE name = 'anvia_durable_backup'")
          .get() !== undefined
      )
        throw new Error("Sealed durable backup; restore it into a new database before opening.");
      this.database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS anvia_durable_owner (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL, token TEXT, pid INTEGER, host TEXT
        );
        INSERT OR IGNORE INTO anvia_durable_owner(singleton, version) VALUES (1, 9);
        CREATE TABLE IF NOT EXISTS anvia_durable_runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_id TEXT NOT NULL,
          status TEXT NOT NULL, record TEXT NOT NULL,
          UNIQUE(session_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS anvia_durable_run_session ON anvia_durable_runs(session_id, status);
        CREATE INDEX IF NOT EXISTS anvia_durable_run_agent_status ON anvia_durable_runs(json_extract(record, '$.agentId'), status);
        CREATE TABLE IF NOT EXISTS anvia_durable_graphs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_id TEXT NOT NULL, record TEXT NOT NULL,
          UNIQUE(session_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS anvia_durable_run_graph ON anvia_durable_runs(json_extract(record, '$.graphId'));
        CREATE TABLE IF NOT EXISTS anvia_durable_operations (
          run_id TEXT NOT NULL, key TEXT NOT NULL, record TEXT NOT NULL,
          PRIMARY KEY(run_id, key)
        );
        CREATE TABLE IF NOT EXISTS anvia_durable_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL, created_at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, history_encoding TEXT
        );
        CREATE INDEX IF NOT EXISTS anvia_durable_event_run ON anvia_durable_events(run_id, sequence);
        ${taskTables}
        ${messageLogTables}
        CREATE TABLE IF NOT EXISTS anvia_durable_run_summaries (
          id TEXT PRIMARY KEY, record TEXT NOT NULL
        );
      `);
      const version = this.database
        .prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1")
        .get();
      if (
        version?.version !== 1 &&
        version?.version !== 2 &&
        version?.version !== 3 &&
        version?.version !== 4 &&
        version?.version !== 5 &&
        version?.version !== 6 &&
        version?.version !== 7 &&
        version?.version !== 8 &&
        version?.version !== 9
      )
        throw new Error("Unsupported durable database schema version.");
      this.histories = messageLog(this.database);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  acquire(): void {
    if (this.closed || this.acquired)
      throw new Error("Durable store is closed or already acquired.");
    this.atomic(() => {
      const owner = this.database
        .prepare("SELECT token, pid, host FROM anvia_durable_owner WHERE singleton = 1")
        .get()!;
      if (owner.token !== null && (owner.host !== hostname() || processExists(Number(owner.pid)))) {
        throw new Error(
          "Durable store already has a live owner. Only one runtime per database is supported.",
        );
      }
      if (
        !this.database
          .prepare("PRAGMA table_info(anvia_durable_events)")
          .all()
          .some((column) => column.name === "history_encoding")
      )
        this.database.exec("ALTER TABLE anvia_durable_events ADD COLUMN history_encoding TEXT");
      // Populate only legacy rows, under the exclusive owner transaction.
      for (const row of this.database
        .prepare(`SELECT r.record FROM anvia_durable_runs r
        LEFT JOIN anvia_durable_run_summaries s ON s.id = r.id WHERE s.id IS NULL`)
        .iterate()) {
        const summary = runSummary(parseRun(JSON.parse(String(row.record))));
        this.database
          .prepare("INSERT INTO anvia_durable_run_summaries VALUES (?, ?)")
          .run(summary.id, JSON.stringify(summary));
      }
      this.database
        .prepare(
          "UPDATE anvia_durable_owner SET token = ?, pid = ?, host = ?, version = 9 WHERE singleton = 1",
        )
        .run(this.token, process.pid, hostname());
    });
    this.acquired = true;
  }

  close(): void {
    if (this.closed) return;
    try {
      if (this.acquired) {
        this.atomic(() => {
          this.database
            .prepare(
              "UPDATE anvia_durable_owner SET token = NULL, pid = NULL, host = NULL WHERE singleton = 1 AND token = ?",
            )
            .run(this.token);
        });
      }
    } finally {
      this.database.close();
      this.closed = true;
      this.acquired = false;
    }
  }

  transaction<T>(callback: (tx: DurableTransaction) => T): T {
    this.assertOpen();
    return this.atomic(() => {
      this.assertOwner();
      let active = true;
      try {
        return callback(
          this.transactionApi(() => {
            if (!active) throw new Error("Durable transaction has finished.");
          }),
        );
      } finally {
        active = false;
      }
    });
  }

  metrics() {
    this.assertOpen();
    return sqliteMetrics(this.database);
  }

  listGraphs(input: DurableGraphListOptions): DurableGraphPage {
    this.assertOpen();
    const options = graphListSchema.parse(input);
    const limit = options.limit ?? 50;
    const filter = options.sessionId === undefined ? "" : "AND session_id = ?";
    const rows = this.database
      .prepare(`SELECT rowid AS cursor, id, session_id, request_id, json_extract(record, '$.createdAt') AS created_at
      FROM anvia_durable_graphs WHERE rowid > ? ${filter} ORDER BY rowid LIMIT ?`)
      .all(
        options.after ?? 0,
        ...(options.sessionId === undefined ? [] : [options.sessionId]),
        limit + 1,
      );
    const page = rows.slice(0, limit);
    return {
      graphs: page.map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        requestId: String(row.request_id),
        createdAt: String(row.created_at),
      })),
      ...(rows.length > limit ? { nextCursor: Number(page.at(-1)!.cursor) } : {}),
    };
  }

  listTasks(options: TaskListOptions) {
    this.assertOpen();
    return listTasks(this.database, options);
  }

  scheduleTasks(excluded: readonly string[], limit: number) {
    this.assertOpen();
    return scheduleTasks(this.database, excluded, limit);
  }

  unsettledTaskRoots(after: number) {
    this.assertOpen();
    return unsettledTaskRoots(this.database, after);
  }

  taskEvents(rootId: string, after: number, limit: number): DurableEvent[] {
    this.assertOpen();
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new TypeError("Invalid task event cursor or page size.");
    return this.database
      .prepare(`SELECT e.* FROM anvia_durable_events e JOIN anvia_durable_tasks t ON t.id = e.run_id
      WHERE t.root_id = ? AND e.sequence > ? ORDER BY e.sequence LIMIT ?`)
      .all(rootId, after, limit)
      .map((row) => ({
        sequence: Number(row.sequence),
        runId: String(row.run_id),
        createdAt: String(row.created_at),
        type: eventTypeSchema.parse(row.type),
        data: this.eventData(row),
      }));
  }

  graphEvents(graphId: string, after: number, limit: number): DurableEvent[] {
    this.assertOpen();
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new TypeError("Invalid graph event cursor or page size.");
    return this.database
      .prepare(`SELECT e.* FROM anvia_durable_events e JOIN anvia_durable_runs r ON r.id = e.run_id
      WHERE json_extract(r.record, '$.graphId') = ? AND e.sequence > ? ORDER BY e.sequence LIMIT ?`)
      .all(graphId, after, limit)
      .map((row) => ({
        sequence: Number(row.sequence),
        runId: String(row.run_id),
        createdAt: String(row.created_at),
        type: eventTypeSchema.parse(row.type),
        data: this.eventData(row),
      }));
  }

  list(input: DurableListOptions): DurableRunPage {
    this.assertOpen();
    const options = listOptionsSchema.parse(input);
    const conditions = ["r.rowid > ?"];
    const parameters: (string | number)[] = [options.after ?? 0];
    for (const [column, value] of [
      ["r.session_id", options.sessionId],
      ["json_extract(r.record, '$.agentId')", options.agentId],
      ["r.status", options.status],
    ] as const) {
      if (value !== undefined) {
        conditions.push(`${column} = ?`);
        parameters.push(value);
      }
    }
    const limit = options.limit ?? 50;
    const rows = this.database
      .prepare(
        `SELECT r.rowid AS cursor, s.record FROM anvia_durable_runs r
         JOIN anvia_durable_run_summaries s ON s.id = r.id
         WHERE ${conditions.join(" AND ")} ORDER BY r.rowid LIMIT ?`,
      )
      .all(...parameters, limit + 1);
    const page = rows.slice(0, limit);
    return {
      runs: page.map((row) => parseRunSummary(JSON.parse(String(row.record)))),
      ...(rows.length > limit ? { nextCursor: Number(page.at(-1)!.cursor) } : {}),
    };
  }

  schedule(
    now: string,
    limit: number,
    excludedSessions: readonly string[],
  ): { ids: string[]; nextAttemptAt?: string } {
    this.assertOpen();
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid scheduler limit.");
    const exclude =
      excludedSessions.length === 0
        ? ""
        : `AND r.session_id NOT IN (${excludedSessions.map(() => "?").join(",")})`;
    const eligible = `FROM anvia_durable_runs r
      WHERE r.status IN ('queued', 'pending', 'running', 'retry_wait') ${exclude}
      AND NOT EXISTS (SELECT 1 FROM anvia_durable_runs previous
        WHERE previous.session_id = r.session_id AND previous.rowid < r.rowid
        AND previous.status NOT IN ('completed', 'failed', 'cancelled'))
      AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(r.record, '$.dependencies')) dependency
        LEFT JOIN anvia_durable_runs prerequisite ON prerequisite.id = dependency.value
        WHERE prerequisite.id IS NULL OR prerequisite.status != 'completed'
          OR json_extract(prerequisite.record, '$.outcome.type') IS NOT 'response')`;
    const ids = this.database
      .prepare(`SELECT r.id ${eligible}
      AND (r.status != 'retry_wait' OR json_extract(r.record, '$.nextAttemptAt') <= ?)
      ORDER BY r.rowid LIMIT ?`)
      .all(...excludedSessions, now, limit)
      .map((row) => String(row.id));
    const wake = this.database
      .prepare(`SELECT MIN(json_extract(r.record, '$.nextAttemptAt')) AS deadline
      ${eligible} AND r.status = 'retry_wait' AND json_extract(r.record, '$.nextAttemptAt') > ?`)
      .get(...excludedSessions, now);
    return { ids, ...(typeof wake?.deadline === "string" ? { nextAttemptAt: wake.deadline } : {}) };
  }

  events(runId: string, after: number, limit: number): DurableEvent[] {
    this.assertOpen();
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new TypeError("Invalid durable event cursor or page size.");
    }
    return this.database
      .prepare(
        "SELECT * FROM anvia_durable_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(runId, after, limit)
      .map((row) => ({
        sequence: Number(row.sequence),
        runId: String(row.run_id),
        createdAt: String(row.created_at),
        type: eventTypeSchema.parse(row.type),
        data: this.eventData(row),
      }));
  }

  private eventData(row: Record<string, unknown>) {
    const data = json(JSON.parse(String(row.data)));
    if (row.history_encoding === null || row.history_encoding === undefined) return data;
    if (row.history_encoding !== "linked-v1" || row.type !== "model_started")
      throw new Error("Unsupported durable event history encoding.");
    return this.histories.unpackEvent(data);
  }

  private transactionApi(assertActive: () => void): DurableTransaction {
    const histories = this.histories;
    const readRun = (sql: string, ...parameters: string[]): DurableRunRecord | undefined => {
      assertActive();
      const row = this.database.prepare(sql).get(...parameters);
      return row === undefined ? undefined : parseRun(JSON.parse(String(row.record)));
    };
    return {
      ...taskTransaction(this.database, assertActive),
      pendingCounts: () => {
        assertActive();
        const count = (table: string) =>
          Number(
            this.database
              .prepare(
                `SELECT COUNT(*) AS n FROM ${table} WHERE status NOT IN ('completed', 'failed', 'cancelled')`,
              )
              .get()!.n,
          );
        return { runs: count("anvia_durable_runs"), tasks: count("anvia_durable_tasks") };
      },
      operationCount: (id) => {
        assertActive();
        return Number(
          this.database
            .prepare("SELECT COUNT(*) AS n FROM anvia_durable_operations WHERE run_id = ?")
            .get(id)!.n,
        );
      },
      getGraph: (id) => {
        assertActive();
        const row = this.database
          .prepare("SELECT record FROM anvia_durable_graphs WHERE id = ?")
          .get(id);
        return row === undefined ? undefined : parseGraphRecord(JSON.parse(String(row.record)));
      },
      findGraphRequest: (session, request) => {
        assertActive();
        const row = this.database
          .prepare(
            "SELECT record FROM anvia_durable_graphs WHERE session_id = ? AND request_id = ?",
          )
          .get(session, request);
        return row === undefined ? undefined : parseGraphRecord(JSON.parse(String(row.record)));
      },
      putGraph: (graph) => {
        assertActive();
        this.database
          .prepare(`INSERT INTO anvia_durable_graphs(id, session_id, request_id, record) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET record = excluded.record`)
          .run(
            graph.id,
            graph.submission.sessionId,
            graph.submission.requestId,
            JSON.stringify(parseGraphRecord(json(graph))),
          );
      },
      getRunSummary: (id) => {
        assertActive();
        const row = this.database
          .prepare("SELECT record FROM anvia_durable_run_summaries WHERE id = ?")
          .get(id);
        return row === undefined ? undefined : parseRunSummary(JSON.parse(String(row.record)));
      },
      getRun: (id) => readRun("SELECT record FROM anvia_durable_runs WHERE id = ?", id),
      findRequest: (session, request) =>
        readRun(
          "SELECT record FROM anvia_durable_runs WHERE session_id = ? AND request_id = ?",
          session,
          request,
        ),
      activeRun: (session) =>
        readRun(
          "SELECT record FROM anvia_durable_runs WHERE session_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') LIMIT 1",
          session,
        ),
      latestCompleted: (session) =>
        readRun(
          "SELECT record FROM anvia_durable_runs WHERE session_id = ? AND status = 'completed' ORDER BY rowid DESC LIMIT 1",
          session,
        ),
      hasLaterStartedRun: (id) => {
        assertActive();
        return (
          this.database
            .prepare(`SELECT 1 FROM anvia_durable_runs later
          JOIN anvia_durable_runs current ON later.session_id = current.session_id
          WHERE current.id = ? AND later.rowid > current.rowid AND (later.status NOT IN ('queued', 'cancelled') OR json_extract(later.record, '$.startedAt') IS NOT NULL) LIMIT 1`)
            .get(id) !== undefined
        );
      },
      putRun: (run) => {
        assertActive();
        const serialized = JSON.stringify(parseRun(json(run)));
        this.database
          .prepare(`INSERT INTO anvia_durable_runs(id, session_id, request_id, status, record)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, record = excluded.record`)
          .run(run.id, run.sessionId, run.requestId, run.status, serialized);
        this.database
          .prepare(`INSERT INTO anvia_durable_run_summaries VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET record = excluded.record`)
          .run(run.id, JSON.stringify(runSummary(run)));
      },
      getOperation: (runId, key) => {
        assertActive();
        const row = this.database
          .prepare("SELECT record FROM anvia_durable_operations WHERE run_id = ? AND key = ?")
          .get(runId, key);
        return row === undefined
          ? undefined
          : parseOperation(histories.unpack(parseOperation(JSON.parse(String(row.record)))));
      },
      operations: (runId) => {
        assertActive();
        return this.database
          .prepare("SELECT record FROM anvia_durable_operations WHERE run_id = ? ORDER BY rowid")
          .all(runId)
          .map((row) => parseOperation(JSON.parse(String(row.record))));
      },
      putOperation: (runId, operation) => {
        assertActive();
        this.database
          .prepare(`INSERT INTO anvia_durable_operations(run_id, key, record) VALUES (?, ?, ?)
          ON CONFLICT(run_id, key) DO UPDATE SET record = excluded.record`)
          .run(
            runId,
            operation.key,
            JSON.stringify(histories.pack(parseOperation(json(operation)))),
          );
      },
      appendEvent: (runId, type, data) => {
        assertActive();
        this.database
          .prepare(
            "INSERT INTO anvia_durable_events(run_id, created_at, type, data, history_encoding) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            runId,
            new Date().toISOString(),
            type,
            JSON.stringify(type === "model_started" ? histories.packEvent(json(data)) : json(data)),
            type === "model_started" ? "linked-v1" : null,
          );
      },
      cursor: () => {
        assertActive();
        return Number(
          this.database
            .prepare("SELECT COALESCE(MAX(sequence), 0) AS cursor FROM anvia_durable_events")
            .get()!.cursor,
        );
      },
    };
  }

  private atomic<T>(callback: () => T): T {
    if (this.inTransaction) throw new Error("Nested durable transactions are not supported.");
    this.database.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = callback();
      if (result !== null && typeof result === "object" && "then" in result) {
        void Promise.resolve(result).catch(() => {});
        throw new TypeError("Durable transactions must be synchronous.");
      }
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  private assertOpen(): void {
    if (this.closed || !this.acquired) throw new Error("Durable store is not acquired.");
  }

  private assertOwner(): void {
    const owner = this.database
      .prepare("SELECT token FROM anvia_durable_owner WHERE singleton = 1")
      .get();
    if (owner?.token !== this.token) throw new Error("Durable store ownership was lost.");
  }
}

function processExists(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function runSummary(run: DurableRunRecord): DurableRunSummary {
  const {
    id,
    agentId,
    sessionId,
    requestId,
    status,
    createdAt,
    updatedAt,
    error,
    blockedOperation,
    nextAttemptAt,
  } = run;
  return {
    id,
    agentId,
    sessionId,
    requestId,
    status,
    createdAt,
    updatedAt,
    ...(error === undefined ? {} : { error }),
    ...(blockedOperation === undefined ? {} : { blockedOperation }),
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
  };
}
