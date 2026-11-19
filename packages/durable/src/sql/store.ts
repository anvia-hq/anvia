import { hostname } from "node:os";
import type { JsonValue } from "@anvia/core/completion";
import { blobIO, externalizeRunRecord, hydrateValue, type DurableBlobIO } from "../blob.js";
import { graphListSchema, parseGraphRecord } from "../graph-schema.js";
import type { DurableGraphListOptions, DurableGraphPage } from "../graph-types.js";
import { DurableClaimLostError } from "../errors.js";
import { json } from "../json.js";
import { messageLog } from "../message-log.js";
import type { DurableMetrics } from "../metrics.js";
import { readStored, writeStored } from "../references.js";
import { runSummary } from "../run-summary.js";
import {
  eventTypeSchema,
  listOptionsSchema,
  parseOperation,
  parseRun,
  parseRunSummary,
} from "../schema.js";
import { SerialGate } from "../serial.js";
import { parseTask, taskListSchema } from "../tasks/schema.js";
import type { TaskListOptions, TaskPage, TaskRecord, TaskTransaction } from "../tasks/types.js";
import type {
  DurableClaim,
  DurableClaimRef,
  DurableEvent,
  DurableListOptions,
  DurableRunPage,
  DurableRunRecord,
  DurableStore,
  DurableTransaction,
  DurableTransactionOptions,
} from "../types.js";
import { POSTGRES_DDL, SQL_CLAIM_TABLES, SQL_SCHEMA_VERSION, SQL_TABLES } from "./ddl.js";
import type { SqlDriver, SqlQuery, SqlRow } from "./driver.js";
import { Staging } from "./staging.js";

export type SqlStoreOptions = {
  /**
   * How long a runtime owns the database without renewing. A crashed owner blocks its replacement
   * for at most this long; a clean `close()` releases ownership at once. Default 30 seconds.
   */
  leaseMs?: number | undefined;
  /** How often the owner renews its lease. Defaults to a third of `leaseMs`. */
  heartbeatMs?: number | undefined;
  /**
   * `"verify"` (default) only checks that the tables exist at the expected version, the right choice
   * when migrations own the schema. `"create"` runs idempotent `CREATE TABLE IF NOT EXISTS`.
   */
  schema?: "verify" | "create" | undefined;
};

const TERMINAL = "('completed', 'failed', 'cancelled')";

const num = (value: unknown): number => Number(value);

function checkLease(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new TypeError("Invalid claim lease.");
}

function claimRefs(claims: readonly DurableClaimRef[]): string {
  return JSON.stringify(claims.map((claim) => ({ run_id: claim.runId, claim_id: claim.claimId })));
}
const text = (value: unknown): string => String(value);

function checkPage(after: number, limit: number, what: string): void {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new TypeError(`Invalid ${what} cursor or page size.`);
}

/**
 * Durable storage over any Postgres client, through the small `SqlDriver` seam. The Postgres,
 * Drizzle and Prisma stores are this class with a different driver.
 *
 * One runtime owns a database at a time. Ownership is a row with a token and a lease: `acquire()`
 * fails while another owner's lease is live, a background heartbeat renews the lease, and every
 * transaction starts by locking the owner row (`SELECT ... FOR UPDATE`) and checking that the token
 * is still this store's. A paused owner whose lease expired therefore cannot commit anything once
 * a new owner has taken over. Writes are serialized by that same row lock.
 */
export class SqlDurableStore implements DurableStore {
  private readonly token = globalThis.crypto.randomUUID();
  private readonly gate = new SerialGate();
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly schemaMode: "verify" | "create";
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private acquired = false;
  private observing = false;
  private joined = false;
  private closed = false;
  private closing = false;
  private lost = false;

  constructor(
    private readonly driver: SqlDriver,
    options: SqlStoreOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1, Math.floor(this.leaseMs / 3));
    this.schemaMode = options.schema ?? "verify";
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1)
      throw new TypeError("leaseMs must be a positive integer.");
    if (!Number.isSafeInteger(this.heartbeatMs) || this.heartbeatMs < 1)
      throw new TypeError("heartbeatMs must be a positive integer.");
  }

  async acquire(): Promise<void> {
    if (this.closed || this.acquired || this.observing || this.joined)
      throw new Error("Durable store is closed or already acquired.");
    if (this.schemaMode === "create") await this.createSchema();
    await this.verifySchema();
    await this.driver.transaction(async (query) => {
      await query(
        "INSERT INTO anvia_durable_owner(singleton, version) VALUES (1, $1::integer) ON CONFLICT (singleton) DO NOTHING",
        [SQL_SCHEMA_VERSION],
      );
      const owner = (
        await query(
          "SELECT token, version, lease_expires_at > now() AS live FROM anvia_durable_owner WHERE singleton = 1 FOR UPDATE",
        )
      )[0]!;
      if (num(owner.version) !== SQL_SCHEMA_VERSION)
        throw new Error("Unsupported durable database schema version.");
      if (owner.token !== null && owner.live === true)
        throw new Error(
          "Durable store already has a live owner. Only one runtime per database is supported.",
        );
      // Shared workers coordinate through claims and an owner assumes it is the only writer, so an
      // owner cannot start while a worker holds a live claim. The table is absent before claims.
      if (
        (await query("SELECT to_regclass('anvia_durable_claims') IS NOT NULL AS present"))[0]!
          .present === true
      ) {
        const live = await query(
          "SELECT 1 FROM anvia_durable_claims WHERE expires_at > now() LIMIT 1",
        );
        if (live.length > 0)
          throw new Error(
            "Durable store has shared workers holding live claims; stop them before opening an owning runtime.",
          );
      }
      await query(
        `UPDATE anvia_durable_owner SET token = $1::text,
           lease_expires_at = now() + ($2::bigint * interval '1 millisecond'),
           host = $3::text, pid = $4::integer WHERE singleton = 1`,
        [this.token, this.leaseMs, hostname(), process.pid],
      );
    });
    this.acquired = true;
    this.heartbeat = setInterval(() => void this.renewOwnerLease(), this.heartbeatMs);
    this.heartbeat.unref();
  }

  async connect(): Promise<void> {
    if (this.closed || this.acquired || this.observing)
      throw new Error("Durable store is closed or already open.");
    // An observer never creates or migrates the schema, whatever `schema` says.
    await this.verifySchema();
    // Tables with no owner row were never initialised by a runtime. Like the SQLite path, an
    // observer needs a database an owner has set up.
    const owner = await this.driver.query(
      "SELECT version FROM anvia_durable_owner WHERE singleton = 1",
    );
    if (owner.length === 0)
      throw new Error(
        "Durable database has not been initialised; open it once with a runtime before observing.",
      );
    this.observing = true;
  }

  async join(): Promise<void> {
    if (this.closed || this.acquired || this.observing || this.joined)
      throw new Error("Durable store is closed or already open.");
    if (this.schemaMode === "create") await this.createSchema();
    await this.verifySchema(SQL_CLAIM_TABLES);
    await this.driver.transaction(async (query) => {
      await query(
        "INSERT INTO anvia_durable_owner(singleton, version) VALUES (1, $1::integer) ON CONFLICT (singleton) DO NOTHING",
        [SQL_SCHEMA_VERSION],
      );
      await this.assertNoLiveOwner(query);
    });
    this.joined = true;
  }

  async claim(input: {
    workerId: string;
    now: string;
    limit: number;
    leaseMs: number;
    agentIds?: readonly string[];
  }): Promise<DurableClaim[]> {
    this.assertJoined();
    if (!Number.isSafeInteger(input.limit) || input.limit < 1)
      throw new TypeError("Invalid claim limit.");
    checkLease(input.leaseMs);
    return this.driver.transaction(async (query) => {
      await this.assertNoLiveOwner(query);
      const candidates = await query(
        `SELECT r.id FROM anvia_durable_runs r
         WHERE r.status IN ('queued', 'pending', 'running', 'retry_wait')
         AND (r.status <> 'retry_wait' OR r.next_attempt_at <= $1::text)
         AND ($3::jsonb IS NULL OR r.agent_id IN (SELECT jsonb_array_elements_text($3::jsonb)))
         AND NOT EXISTS (SELECT 1 FROM anvia_durable_runs previous
           WHERE previous.session_id = r.session_id AND previous.seq < r.seq
           AND previous.status NOT IN ${TERMINAL})
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.dependencies, '[]'::jsonb)) AS dependency(value)
           LEFT JOIN anvia_durable_runs prerequisite ON prerequisite.id = dependency.value
           WHERE prerequisite.id IS NULL OR prerequisite.status <> 'completed'
             OR prerequisite.outcome_type IS DISTINCT FROM 'response')
         AND NOT EXISTS (SELECT 1 FROM anvia_durable_claims c
           WHERE c.run_id = r.id AND c.expires_at > now())
         ORDER BY r.seq LIMIT $2::bigint`,
        [
          input.now,
          input.limit,
          input.agentIds === undefined ? null : JSON.stringify(input.agentIds),
        ],
      );
      return takeClaims(
        query,
        candidates.map((candidate) => text(candidate.id)),
        input.workerId,
        input.leaseMs,
      );
    });
  }

  async claimTasks(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
    names: readonly string[];
  }): Promise<DurableClaim[]> {
    this.assertJoined();
    if (!Number.isSafeInteger(input.limit) || input.limit < 1)
      throw new TypeError("Invalid claim limit.");
    checkLease(input.leaseMs);
    if (input.names.length === 0) return [];
    return this.driver.transaction(async (query) => {
      await this.assertNoLiveOwner(query);
      // The stored record is plain JSON, so the task name filters without a schema change.
      const candidates = await query(
        `SELECT t.id FROM anvia_durable_tasks t
         WHERE t.status IN ('pending', 'running')
         AND (t.record::jsonb ->> 'name') IN (SELECT jsonb_array_elements_text($2::text::jsonb))
         AND NOT EXISTS (SELECT 1 FROM anvia_durable_claims c
           WHERE c.run_id = t.id AND c.expires_at > now())
         ORDER BY t.ready_order, t.seq LIMIT $1::bigint`,
        [input.limit, JSON.stringify(input.names)],
      );
      return takeClaims(
        query,
        candidates.map((candidate) => text(candidate.id)),
        input.workerId,
        input.leaseMs,
      );
    });
  }

  async renew(input: {
    workerId: string;
    claims: readonly DurableClaimRef[];
    leaseMs: number;
  }): Promise<{ lost: string[] }> {
    this.assertJoined();
    checkLease(input.leaseMs);
    if (input.claims.length === 0) return { lost: [] };
    // A claim names a run or a task. A run is held until it settles; a task only while it is
    // executing (`pending` or `running`), since any other status means no invocation is running.
    const rows = await this.driver.query(
      `UPDATE anvia_durable_claims c SET expires_at = now() + ($3::bigint * interval '1 millisecond')
       FROM jsonb_to_recordset($2::text::jsonb) AS held(run_id text, claim_id text)
       WHERE c.worker_id = $1::text AND c.run_id = held.run_id AND c.claim_id = held.claim_id
         AND (EXISTS (SELECT 1 FROM anvia_durable_runs r
                WHERE r.id = c.run_id AND r.status NOT IN ${TERMINAL})
           OR EXISTS (SELECT 1 FROM anvia_durable_tasks t
                WHERE t.id = c.run_id AND t.status IN ('pending', 'running')))
       RETURNING c.run_id`,
      [input.workerId, claimRefs(input.claims), input.leaseMs],
    );
    const renewed = new Set(rows.map((row) => text(row.run_id)));
    return { lost: input.claims.map((claim) => claim.runId).filter((id) => !renewed.has(id)) };
  }

  async release(claims: readonly DurableClaimRef[]): Promise<void> {
    this.assertJoined();
    if (claims.length === 0) return;
    await this.driver.query(
      `DELETE FROM anvia_durable_claims c
       USING jsonb_to_recordset($1::text::jsonb) AS held(run_id text, claim_id text)
       WHERE c.run_id = held.run_id AND c.claim_id = held.claim_id`,
      [claimRefs(claims)],
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    try {
      await this.gate.read(() => undefined);
      if (this.acquired && !this.lost)
        await this.driver.query(
          `UPDATE anvia_durable_owner SET token = NULL, lease_expires_at = NULL, host = NULL, pid = NULL
           WHERE singleton = 1 AND token = $1::text`,
          [this.token],
        );
    } finally {
      this.closed = true;
      this.acquired = false;
      this.observing = false;
      this.joined = false;
      await this.driver.close?.();
    }
  }

  async transaction<T>(
    callback: (tx: DurableTransaction) => Promise<T>,
    options?: DurableTransactionOptions,
  ): Promise<T> {
    // Only a shared store honours it: an owner is the sole writer and keeps its token check.
    const readOnly = options?.readOnly === true && this.joined;
    this.assertOpen();
    return this.gate.transaction(() => {
      // Transactions queued before close() still run: close() waits for them.
      if (this.closed) throw new Error("Durable store is not acquired.");
      return this.driver.transaction(async (query) => {
        // Enforced by Postgres, and no owner row lock is taken, so an observer never blocks the owner.
        if (this.observing || readOnly) await query("SET TRANSACTION READ ONLY");
        else if (!this.joined) await this.assertOwner(query);
        let active = true;
        const staging = new Staging();
        try {
          return await callback(
            this.transactionApi(
              query,
              staging,
              () => {
                if (!active) throw new Error("Durable transaction has finished.");
              },
              this.joined && !readOnly,
            ),
          );
        } finally {
          active = false;
        }
      });
    });
  }

  async metrics(): Promise<DurableMetrics> {
    return this.read(async (query) => {
      const statuses = async (table: string) =>
        Object.fromEntries(
          (await query(`SELECT status, COUNT(*)::text AS n FROM ${table} GROUP BY status`)).map(
            (row) => [text(row.status), num(row.n)],
          ),
        );
      const count = async (table: string) =>
        num((await query(`SELECT COUNT(*)::text AS n FROM ${table}`))[0]!.n);
      const oldest = (
        await query(`SELECT MIN(created) AS oldest FROM (
          SELECT MIN(created_at) AS created FROM anvia_durable_runs WHERE status NOT IN ${TERMINAL}
          UNION ALL SELECT MIN(created_at) FROM anvia_durable_tasks WHERE status NOT IN ${TERMINAL}
        ) pending`)
      )[0]!.oldest;
      const bytes = (
        await query(`SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::text AS bytes
          FROM pg_class c WHERE c.relkind = 'r' AND c.relname LIKE 'anvia\\_durable\\_%'
          AND pg_table_is_visible(c.oid)`)
      )[0]!.bytes;
      return {
        observedAt: new Date().toISOString(),
        runs: await statuses("anvia_durable_runs"),
        tasks: await statuses("anvia_durable_tasks"),
        oldestPendingAgeMs:
          typeof oldest === "string" ? Math.max(0, Date.now() - Date.parse(oldest)) : 0,
        operations: await count("anvia_durable_operations"),
        events: await count("anvia_durable_events"),
        databaseBytes: num(bytes),
      };
    });
  }

  async listGraphs(input: DurableGraphListOptions): Promise<DurableGraphPage> {
    const options = graphListSchema.parse(input);
    const limit = options.limit ?? 50;
    const params: unknown[] = [options.after ?? 0];
    let filter = "";
    if (options.sessionId !== undefined) {
      params.push(options.sessionId);
      filter = `AND session_id = $${params.length}::text`;
    }
    params.push(limit + 1);
    const rows = await this.read((query) =>
      query(
        `SELECT seq::text AS cursor, id, session_id, request_id, created_at
         FROM anvia_durable_graphs WHERE seq > $1::bigint ${filter}
         ORDER BY seq LIMIT $${params.length}::bigint`,
        params,
      ),
    );
    const page = rows.slice(0, limit);
    const result: DurableGraphPage = {
      graphs: page.map((row) => ({
        id: text(row.id),
        sessionId: text(row.session_id),
        requestId: text(row.request_id),
        createdAt: text(row.created_at),
      })),
    };
    if (rows.length > limit) result.nextCursor = num(page.at(-1)!.cursor);
    return result;
  }

  async listTasks(input: TaskListOptions): Promise<TaskPage> {
    const options = taskListSchema.parse(input);
    const limit = options.limit ?? 50;
    const params: unknown[] = [options.after ?? 0];
    let filter = "";
    if (options.sessionId !== undefined) {
      params.push(options.sessionId);
      filter = `AND session_id = $${params.length}::text`;
    }
    params.push(limit + 1);
    const rows = await this.read((query) =>
      query(
        `SELECT seq::text AS cursor, record FROM anvia_durable_tasks
         WHERE parent_id = '' AND seq > $1::bigint ${filter} ORDER BY seq LIMIT $${params.length}::bigint`,
        params,
      ),
    );
    const page = rows.slice(0, limit);
    const result: TaskPage = { tasks: page.map((row) => parseTask(readStored(text(row.record)))) };
    if (rows.length > limit) result.nextCursor = num(page.at(-1)!.cursor);
    return result;
  }

  async scheduleTasks(excluded: readonly string[], limit: number): Promise<string[]> {
    const rows = await this.read((query) =>
      query(
        `SELECT id FROM anvia_durable_tasks WHERE status IN ('pending', 'running')
         AND id NOT IN (SELECT jsonb_array_elements_text($1::text::jsonb))
         ORDER BY ready_order, seq LIMIT $2::bigint`,
        [JSON.stringify(excluded), limit],
      ),
    );
    return rows.map((row) => text(row.id));
  }

  async unsettledTaskRoots(after: number): Promise<{ ids: string[]; cursor?: number }> {
    const rows = await this.read((query) =>
      query(
        `SELECT seq::text AS cursor, id FROM anvia_durable_tasks
         WHERE parent_id = '' AND status NOT IN ${TERMINAL} AND seq > $1::bigint
         ORDER BY seq LIMIT 100`,
        [after],
      ),
    );
    const result: { ids: string[]; cursor?: number } = { ids: rows.map((row) => text(row.id)) };
    if (rows.length === 100) result.cursor = num(rows.at(-1)!.cursor);
    return result;
  }

  async taskEvents(rootId: string, after: number, limit: number): Promise<DurableEvent[]> {
    checkPage(after, limit, "task event");
    return this.readEvents(
      `SELECT e.* FROM anvia_durable_events e JOIN anvia_durable_tasks t ON t.id = e.run_id
       WHERE t.root_id = $1::text AND e.sequence > $2::bigint ORDER BY e.sequence LIMIT $3::bigint`,
      [rootId, after, limit],
    );
  }

  async graphEvents(graphId: string, after: number, limit: number): Promise<DurableEvent[]> {
    checkPage(after, limit, "graph event");
    return this.readEvents(
      `SELECT e.* FROM anvia_durable_events e JOIN anvia_durable_runs r ON r.id = e.run_id
       WHERE r.graph_id = $1::text AND e.sequence > $2::bigint ORDER BY e.sequence LIMIT $3::bigint`,
      [graphId, after, limit],
    );
  }

  async events(runId: string, after: number, limit: number): Promise<DurableEvent[]> {
    checkPage(after, limit, "durable event");
    return this.readEvents(
      `SELECT * FROM anvia_durable_events WHERE run_id = $1::text AND sequence > $2::bigint
       ORDER BY sequence LIMIT $3::bigint`,
      [runId, after, limit],
    );
  }

  async list(input: DurableListOptions): Promise<DurableRunPage> {
    const options = listOptionsSchema.parse(input);
    const params: unknown[] = [options.after ?? 0];
    const conditions = ["r.seq > $1::bigint"];
    for (const [column, value] of [
      ["r.session_id", options.sessionId],
      ["r.agent_id", options.agentId],
      ["r.status", options.status],
    ] as const) {
      if (value === undefined) continue;
      params.push(value);
      conditions.push(`${column} = $${params.length}::text`);
    }
    const limit = options.limit ?? 50;
    params.push(limit + 1);
    const rows = await this.read((query) =>
      query(
        `SELECT r.seq::text AS cursor, s.record FROM anvia_durable_runs r
         JOIN anvia_durable_run_summaries s ON s.id = r.id
         WHERE ${conditions.join(" AND ")} ORDER BY r.seq LIMIT $${params.length}::bigint`,
        params,
      ),
    );
    const page = rows.slice(0, limit);
    const result: DurableRunPage = {
      runs: page.map((row) => parseRunSummary(JSON.parse(text(row.record)))),
    };
    if (rows.length > limit) result.nextCursor = num(page.at(-1)!.cursor);
    return result;
  }

  async schedule(
    now: string,
    limit: number,
    excludedSessions: readonly string[],
  ): Promise<{ ids: string[]; nextAttemptAt?: string }> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid scheduler limit.");
    const eligible = `FROM anvia_durable_runs r
      WHERE r.status IN ('queued', 'pending', 'running', 'retry_wait')
      AND r.session_id NOT IN (SELECT jsonb_array_elements_text($1::text::jsonb))
      AND NOT EXISTS (SELECT 1 FROM anvia_durable_runs previous
        WHERE previous.session_id = r.session_id AND previous.seq < r.seq
        AND previous.status NOT IN ${TERMINAL})
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.dependencies, '[]'::jsonb)) AS dependency(value)
        LEFT JOIN anvia_durable_runs prerequisite ON prerequisite.id = dependency.value
        WHERE prerequisite.id IS NULL OR prerequisite.status <> 'completed'
          OR prerequisite.outcome_type IS DISTINCT FROM 'response')`;
    const excluded = JSON.stringify(excludedSessions);
    return this.read(async (query) => {
      const ids = (
        await query(
          `SELECT r.id ${eligible}
           AND (r.status <> 'retry_wait' OR r.next_attempt_at <= $2::text)
           ORDER BY r.seq LIMIT $3::bigint`,
          [excluded, now, limit],
        )
      ).map((row) => text(row.id));
      const wake = (
        await query(
          `SELECT MIN(r.next_attempt_at) AS deadline ${eligible}
           AND r.status = 'retry_wait' AND r.next_attempt_at > $2::text`,
          [excluded, now],
        )
      )[0];
      const result: { ids: string[]; nextAttemptAt?: string } = { ids };
      if (typeof wake?.deadline === "string") result.nextAttemptAt = wake.deadline;
      return result;
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** Runs a read after the open transaction, or at once from inside one. */
  private read<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    this.assertOpen();
    return this.gate.read(() => fn(this.driver.query));
  }

  private async readEvents(sql: string, params: unknown[]): Promise<DurableEvent[]> {
    return this.read(async (query) => {
      const rows = await query(sql, params);
      const staging = new Staging();
      const events: DurableEvent[] = [];
      for (const row of rows) events.push(await this.eventOf(query, staging, row));
      return events;
    });
  }

  private async eventOf(query: SqlQuery, staging: Staging, row: SqlRow): Promise<DurableEvent> {
    const histories = messageLog(staging);
    const blobs = blobIO(staging);
    const data = await staging.run(query, (): JsonValue => {
      // Events are terminal, so their readers always see fully restored payloads.
      if (row.history_encoding !== null && row.history_encoding !== undefined) {
        if (row.history_encoding !== "linked-v1" || row.type !== "model_started")
          throw new Error("Unsupported durable event history encoding.");
        return json(hydrateValue(blobs, histories.unpackEvent(json(readStored(text(row.data))))));
      }
      const stored = text(row.data);
      if (!stored.includes("anvia:blob") && !stored.includes("durableBlobs"))
        return json(readStored(stored));
      return json(hydrateValue(blobs, json(readStored(stored))));
    });
    return {
      sequence: num(row.sequence),
      runId: text(row.run_id),
      createdAt: text(row.created_at),
      type: eventTypeSchema.parse(row.type),
      data,
    };
  }

  private transactionApi(
    query: SqlQuery,
    staging: Staging,
    assertActive: () => void,
    shared = false,
  ): DurableTransaction {
    // With shared workers and clients, several processes read-modify-write the same run, so a
    // run read in a read-write transaction is locked until it ends. An owner is the only writer.
    const lock = shared ? " FOR UPDATE" : "";
    const histories = messageLog(staging);
    const blobs = blobIO(staging);
    const guarded = async (sql: string, params: unknown[] = []): Promise<SqlRow[]> => {
      assertActive();
      return query(sql, params);
    };
    const withBlobs = <T>(fn: () => T): Promise<T> => {
      assertActive();
      return staging.run(query, fn);
    };
    /** Parses a stored run; only the prompt is restored from its blob, as in the SQLite store. */
    const decodeRun = (stored: string): Promise<DurableRunRecord> =>
      withBlobs(() => {
        const value = readStored(stored) as Record<string, JsonValue>;
        if (!stored.includes("anvia:blob") && !stored.includes("durableBlobs"))
          return parseRun(value);
        return parseRun({ ...value, prompt: hydrateValue(blobs, json(value.prompt)) });
      });
    const readRun = async (sql: string, ...params: unknown[]) => {
      const row = (await guarded(sql, params))[0];
      return row === undefined ? undefined : decodeRun(text(row.record));
    };
    const readTasks = async (sql: string, ...params: unknown[]): Promise<TaskRecord[]> =>
      (await guarded(sql, params)).map((row) => parseTask(readStored(text(row.record))));
    const tasks: TaskTransaction = {
      getTask: async (id) =>
        (await readTasks("SELECT record FROM anvia_durable_tasks WHERE id = $1::text", id))[0],
      findTask: async (session, parent, key) =>
        (
          await readTasks(
            "SELECT record FROM anvia_durable_tasks WHERE session_id = $1::text AND parent_id = $2::text AND key = $3::text",
            session,
            parent ?? "",
            key,
          )
        )[0],
      taskChildren: (id) =>
        readTasks(
          "SELECT record FROM anvia_durable_tasks WHERE parent_id = $1::text ORDER BY seq",
          id,
        ),
      taskTree: (root) =>
        readTasks(
          "SELECT record FROM anvia_durable_tasks WHERE root_id = $1::text ORDER BY seq",
          root,
        ),
      putTask: async (value) => {
        const task = parseTask(value);
        await guarded(
          `INSERT INTO anvia_durable_tasks(id, root_id, parent_id, session_id, key, status, record, created_at, ready_order)
           VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text,
             (SELECT COALESCE(MAX(sequence), 0) + 1 FROM anvia_durable_events))
           ON CONFLICT (id) DO UPDATE SET status = excluded.status, record = excluded.record,
             ready_order = excluded.ready_order`,
          [
            task.id,
            task.rootId,
            task.parentId ?? "",
            task.sessionId,
            task.key,
            task.status,
            writeStored(task),
            task.createdAt,
          ],
        );
      },
    };
    const count = async (table: string) =>
      num(
        (
          await guarded(`SELECT COUNT(*)::text AS n FROM ${table} WHERE status NOT IN ${TERMINAL}`)
        )[0]!.n,
      );
    return {
      ...tasks,
      pendingCounts: async () => ({
        runs: await count("anvia_durable_runs"),
        tasks: await count("anvia_durable_tasks"),
      }),
      operationCount: async (id) =>
        num(
          (
            await guarded(
              "SELECT COUNT(*)::text AS n FROM anvia_durable_operations WHERE run_id = $1::text",
              [id],
            )
          )[0]!.n,
        ),
      getGraph: async (id) => {
        const row = (
          await guarded("SELECT record FROM anvia_durable_graphs WHERE id = $1::text", [id])
        )[0];
        return row === undefined ? undefined : parseGraphRecord(readStored(text(row.record)));
      },
      findGraphRequest: async (session, request) => {
        const row = (
          await guarded(
            "SELECT record FROM anvia_durable_graphs WHERE session_id = $1::text AND request_id = $2::text",
            [session, request],
          )
        )[0];
        return row === undefined ? undefined : parseGraphRecord(readStored(text(row.record)));
      },
      putGraph: async (graph) => {
        const record = parseGraphRecord(json(graph));
        await guarded(
          `INSERT INTO anvia_durable_graphs(id, session_id, request_id, created_at, record)
           VALUES ($1::text, $2::text, $3::text, $4::text, $5::text)
           ON CONFLICT (id) DO UPDATE SET record = excluded.record`,
          [
            graph.id,
            graph.submission.sessionId,
            graph.submission.requestId,
            record.createdAt,
            writeStored(record),
          ],
        );
      },
      getRunSummary: async (id) => {
        const row = (
          await guarded("SELECT record FROM anvia_durable_run_summaries WHERE id = $1::text", [id])
        )[0];
        return row === undefined ? undefined : parseRunSummary(JSON.parse(text(row.record)));
      },
      getRun: (id) =>
        readRun(`SELECT record FROM anvia_durable_runs WHERE id = $1::text${lock}`, id),
      findRequest: (session, request) =>
        readRun(
          `SELECT record FROM anvia_durable_runs WHERE session_id = $1::text AND request_id = $2::text${lock}`,
          session,
          request,
        ),
      activeRun: (session) =>
        readRun(
          `SELECT record FROM anvia_durable_runs WHERE session_id = $1::text AND status NOT IN ${TERMINAL} LIMIT 1${lock}`,
          session,
        ),
      lockSession: async (session) => {
        // Serialises submissions of one session so "no unfinished work" cannot race.
        await guarded("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [session]);
      },
      latestCompleted: (session) =>
        readRun(
          `SELECT record FROM anvia_durable_runs WHERE session_id = $1::text
           AND (status = 'completed' OR (status IN ('failed', 'cancelled') AND started_at IS NOT NULL))
           ORDER BY seq DESC LIMIT 1`,
          session,
        ),
      hasLaterStartedRun: async (id) =>
        (
          await guarded(
            `SELECT 1 FROM anvia_durable_runs later
             JOIN anvia_durable_runs current ON later.session_id = current.session_id
             WHERE current.id = $1::text AND later.seq > current.seq
             AND (later.status NOT IN ('queued', 'cancelled') OR later.started_at IS NOT NULL) LIMIT 1`,
            [id],
          )
        ).length > 0,
      putRun: async (run) => {
        assertActive();
        // Validate the logical record, then store its prompt and input behind blob references.
        const logical = parseRun(json(run));
        const serialized = await staging.run(query, () =>
          writeStored(externalizeRunRecord(blobs, logical)),
        );
        await guarded(
          `INSERT INTO anvia_durable_runs(id, session_id, request_id, status, agent_id, graph_id, created_at,
             started_at, next_attempt_at, outcome_type, dependencies, record)
           VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text,
             $10::text, $11::text::jsonb, $12::text)
           ON CONFLICT (id) DO UPDATE SET status = excluded.status, graph_id = excluded.graph_id,
             started_at = excluded.started_at, next_attempt_at = excluded.next_attempt_at,
             outcome_type = excluded.outcome_type, dependencies = excluded.dependencies,
             record = excluded.record`,
          [
            run.id,
            run.sessionId,
            run.requestId,
            run.status,
            run.agentId,
            run.graphId ?? null,
            run.createdAt,
            run.startedAt ?? null,
            run.nextAttemptAt ?? null,
            run.outcome?.type ?? null,
            run.dependencies === undefined ? null : JSON.stringify(run.dependencies),
            serialized,
          ],
        );
        await guarded(
          `INSERT INTO anvia_durable_run_summaries(id, record) VALUES ($1::text, $2::text)
           ON CONFLICT (id) DO UPDATE SET record = excluded.record`,
          [run.id, JSON.stringify(runSummary(run))],
        );
      },
      getOperation: async (runId, key) => {
        const row = (
          await guarded(
            "SELECT record FROM anvia_durable_operations WHERE run_id = $1::text AND key = $2::text",
            [runId, key],
          )
        )[0];
        if (row === undefined) return undefined;
        return withBlobs(() =>
          parseOperation(histories.unpack(parseOperation(readStored(text(row.record))))),
        );
      },
      operations: async (runId) =>
        (
          await guarded(
            "SELECT record FROM anvia_durable_operations WHERE run_id = $1::text ORDER BY seq",
            [runId],
          )
        ).map((row) => parseOperation(readStored(text(row.record)))),
      putOperation: async (runId, operation) => {
        assertActive();
        const logical = parseOperation(json(operation));
        const stored = await staging.run(query, () => writeStored(histories.pack(logical)));
        await guarded(
          `INSERT INTO anvia_durable_operations(run_id, key, record) VALUES ($1::text, $2::text, $3::text)
           ON CONFLICT (run_id, key) DO UPDATE SET record = excluded.record`,
          [runId, operation.key, stored],
        );
      },
      appendEvent: async (runId, type, data) => {
        assertActive();
        const stored = await staging.run(query, () =>
          writeStored(type === "model_started" ? histories.packEvent(json(data)) : json(data)),
        );
        await guarded(
          `INSERT INTO anvia_durable_events(run_id, created_at, type, data, history_encoding)
           VALUES ($1::text, $2::text, $3::text, $4::text, $5::text)`,
          [
            runId,
            new Date().toISOString(),
            type,
            stored,
            type === "model_started" ? "linked-v1" : null,
          ],
        );
      },
      isClaimed: async (id) =>
        (
          await guarded(
            "SELECT 1 FROM anvia_durable_claims WHERE run_id = $1::text AND expires_at > now() LIMIT 1",
            [id],
          )
        ).length > 0,
      assertClaim: async (runId, claimId) => {
        // FOR SHARE: a reclaim of this run waits for this transaction, so a stale worker cannot
        // commit after another worker took the run.
        const held = await guarded(
          "SELECT 1 FROM anvia_durable_claims WHERE run_id = $1::text AND claim_id = $2::text FOR SHARE",
          [runId, claimId],
        );
        if (held.length === 0) throw new DurableClaimLostError(runId, claimId);
      },
      cursor: async () =>
        num(
          (
            await guarded(
              "SELECT COALESCE(MAX(sequence), 0)::text AS cursor FROM anvia_durable_events",
            )
          )[0]!.cursor,
        ),
      blobs: <T>(fn: (io: DurableBlobIO) => T) => withBlobs(() => fn(blobs)),
      putBlob: (value) => withBlobs(() => blobs.putBlob(value)),
      getBlob: (hash) => withBlobs(() => blobs.getBlob(hash)),
    };
  }

  private async createSchema(): Promise<void> {
    await this.driver.transaction(async (query) => {
      // Serializes concurrent first-time setups; released at commit.
      await query("SELECT pg_advisory_xact_lock(hashtext('anvia_durable_schema'))");
      for (const statement of POSTGRES_DDL) await query(statement);
    });
  }

  private async verifySchema(extra: readonly string[] = []): Promise<void> {
    const rows = await this.driver.query(
      `SELECT name FROM unnest($1::text::text[]) AS name WHERE to_regclass(name) IS NULL`,
      [`{${[...SQL_TABLES, ...extra].join(",")}}`],
    );
    if (rows.length > 0)
      throw new Error(
        `Durable schema is missing: ${rows.map((row) => text(row.name)).join(", ")}. ` +
          "Create it with your migrations (see the anvia-durable-drizzle / anvia-durable-prisma generators), " +
          'or open the Postgres store with schema: "create".',
      );
    const version = (
      await this.driver.query("SELECT version FROM anvia_durable_owner WHERE singleton = 1")
    )[0]?.version;
    if (version !== undefined && num(version) !== SQL_SCHEMA_VERSION)
      throw new Error("Unsupported durable database schema version.");
  }

  private async renewOwnerLease(): Promise<void> {
    if (this.closed || !this.acquired) return;
    try {
      const rows = await this.driver.query(
        `UPDATE anvia_durable_owner SET lease_expires_at = now() + ($2::bigint * interval '1 millisecond')
         WHERE singleton = 1 AND token = $1::text RETURNING 1 AS ok`,
        [this.token, this.leaseMs],
      );
      if (rows.length === 0) this.lost = true;
    } catch {
      // A failed renewal is retried on the next beat. Transactions still check the owner token.
    }
  }

  private async assertOwner(query: SqlQuery): Promise<void> {
    const owner = (
      await query("SELECT token FROM anvia_durable_owner WHERE singleton = 1 FOR UPDATE")
    )[0];
    if (owner?.token !== this.token) {
      this.lost = true;
      throw new Error("Durable store ownership was lost.");
    }
  }

  private assertOpen(): void {
    if (this.closed || this.closing || (!this.acquired && !this.observing && !this.joined))
      throw new Error("Durable store is not acquired.");
  }

  private assertJoined(): void {
    if (this.closed || this.closing || !this.joined)
      throw new Error("Durable store has not joined as a shared worker.");
  }

  /** Locks the owner row shared, so an owner acquiring concurrently waits and then sees our claims. */
  private async assertNoLiveOwner(query: SqlQuery): Promise<void> {
    const owner = (
      await query(
        "SELECT token, version, lease_expires_at > now() AS live FROM anvia_durable_owner WHERE singleton = 1 FOR SHARE",
      )
    )[0];
    if (owner === undefined) throw new Error("Durable database has not been initialised.");
    if (num(owner.version) !== SQL_SCHEMA_VERSION)
      throw new Error("Unsupported durable database schema version.");
    if (owner.token !== null && owner.live === true)
      throw new Error(
        "Durable store has a live owning runtime; shared workers cannot run beside an owner.",
      );
  }
}

/**
 * Takes the claim on each id whose lease has lapsed. The conflict clause is the exclusion: a
 * concurrent claimer of the same id waits on the row lock and then matches nothing. Run ids and
 * task ids are random UUIDs, so one table holds both.
 */
async function takeClaims(
  query: SqlQuery,
  ids: readonly string[],
  workerId: string,
  leaseMs: number,
): Promise<DurableClaim[]> {
  const claims: DurableClaim[] = [];
  for (const id of ids) {
    const rows = await query(
      `INSERT INTO anvia_durable_claims(run_id, worker_id, claim_id, expires_at)
       VALUES ($1::text, $2::text, $3::text, now() + ($4::bigint * interval '1 millisecond'))
       ON CONFLICT (run_id) DO UPDATE SET worker_id = EXCLUDED.worker_id,
         claim_id = EXCLUDED.claim_id, expires_at = EXCLUDED.expires_at
       WHERE anvia_durable_claims.expires_at <= now()
       RETURNING run_id, claim_id,
         to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
      [id, workerId, globalThis.crypto.randomUUID(), leaseMs],
    );
    const row = rows[0];
    if (row !== undefined)
      claims.push({
        runId: text(row.run_id),
        claimId: text(row.claim_id),
        expiresAt: text(row.expires_at),
      });
  }
  return claims;
}
