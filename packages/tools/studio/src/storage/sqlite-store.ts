import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { JsonObject, Message } from "@anvia/core";
import type {
  StudioSession,
  StudioSessionAppendInput,
  StudioSessionCreateInput,
  StudioSessionListOptions,
  StudioSessionStore,
  StudioSessionSummary,
  StudioSessionTraceListOptions,
  StudioTrace,
  StudioTraceListOptions,
  StudioTraceStore,
  StudioTraceSummary,
  StudioTranscriptEntry,
} from "../types";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export type SqliteSessionStoreOptions = {
  path?: string;
};

type SessionRow = {
  id: string;
  agent_id: string;
  title: string | null;
  metadata_json: string | null;
  messages_json: string;
  transcript_json: string;
  created_at: string;
  updated_at: string;
};

type TraceRow = {
  id: string;
  session_id: string;
  name: string | null;
  status: StudioTrace["status"];
  trace_json: string | null;
  input_json: string | null;
  output: string | null;
  error_json: string | null;
  usage_json: string | null;
  metadata_json: string | null;
  observations_json: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
};

export function createSqliteSessionStore(
  options: SqliteSessionStoreOptions = {},
): StudioSessionStore & StudioTraceStore {
  return new SqliteSessionStore(options.path ?? ":memory:");
}

class SqliteSessionStore implements StudioSessionStore, StudioTraceStore {
  readonly kind = "sqlite";
  private db: DatabaseSyncType | undefined;

  constructor(private readonly path: string) {}

  listSessions(options: StudioSessionListOptions): StudioSessionSummary[] {
    const db = this.database();
    const agentClause = options.agentId === undefined ? "" : "WHERE agent_id = $agentId";
    const rows = db
      .prepare(
        `SELECT id, agent_id, title, metadata_json, messages_json, transcript_json, created_at, updated_at
         FROM runner_sessions
         ${agentClause}
         ORDER BY updated_at DESC
         LIMIT $limit`,
      )
      .all({
        $agentId: options.agentId ?? null,
        $limit: options.limit,
      }) as SessionRow[];

    return rows.map(toSessionSummary);
  }

  createSession(input: StudioSessionCreateInput): StudioSessionSummary {
    const db = this.database();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO runner_sessions (
        id,
        agent_id,
        title,
        metadata_json,
        messages_json,
        transcript_json,
        created_at,
        updated_at
      ) VALUES ($id, $agentId, $title, $metadata, '[]', '[]', $now, $now)`,
    ).run({
      $id: input.id,
      $agentId: input.agentId,
      $title: input.title ?? null,
      $metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
      $now: now,
    });

    return {
      id: input.id,
      agentId: input.agentId,
      ...(input.title === undefined ? {} : { title: input.title }),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
  }

  getSession(id: string): StudioSession | undefined {
    const db = this.database();
    const row = db
      .prepare(
        `SELECT id, agent_id, title, metadata_json, messages_json, transcript_json, created_at, updated_at
         FROM runner_sessions
         WHERE id = $id`,
      )
      .get({ $id: id }) as SessionRow | undefined;

    return row === undefined ? undefined : toSession(row);
  }

  appendSessionRun(input: StudioSessionAppendInput): StudioSession | undefined {
    const db = this.database();

    try {
      db.exec("BEGIN IMMEDIATE");
      const row = db
        .prepare(
          `SELECT id, agent_id, title, metadata_json, messages_json, transcript_json, created_at, updated_at
           FROM runner_sessions
           WHERE id = $id`,
        )
        .get({ $id: input.id }) as SessionRow | undefined;

      if (row === undefined) {
        db.exec("ROLLBACK");
        return undefined;
      }

      const current = toSession(row);
      const messages = [...current.messages, ...input.messages];
      const transcript = renumberTranscript([...current.transcript, ...input.transcript]);
      const title = current.title ?? input.title;
      const updatedAt = new Date().toISOString();

      db.prepare(
        `UPDATE runner_sessions
         SET title = $title,
             messages_json = $messages,
             transcript_json = $transcript,
             updated_at = $updatedAt
         WHERE id = $id`,
      ).run({
        $id: input.id,
        $title: title ?? null,
        $messages: JSON.stringify(messages),
        $transcript: JSON.stringify(transcript),
        $updatedAt: updatedAt,
      });
      db.exec("COMMIT");

      return {
        ...current,
        ...(title === undefined ? {} : { title }),
        updatedAt,
        messageCount: messages.length,
        messages,
        transcript,
      };
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  deleteSession(id: string): boolean {
    const db = this.database();

    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("DELETE FROM runner_traces WHERE session_id = $id").run({ $id: id });
      const result = db.prepare("DELETE FROM runner_sessions WHERE id = $id").run({ $id: id }) as {
        changes: number | bigint;
      };
      db.exec("COMMIT");
      return Number(result.changes) > 0;
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  listTraces(options: StudioTraceListOptions): StudioTraceSummary[] {
    const db = this.database();
    const filters: string[] = [];
    const values: Record<string, string | number | null> = {
      $limit: options.limit,
    };

    if (options.agentId !== undefined) {
      filters.push(
        "(s.agent_id = $agentId OR json_extract(t.metadata_json, '$.metadata.agentId') = $agentId)",
      );
      values.$agentId = options.agentId;
    }
    if (options.sessionId !== undefined) {
      filters.push("t.session_id = $sessionId");
      values.$sessionId = options.sessionId;
    }
    if (options.status !== undefined) {
      filters.push("t.status = $status");
      values.$status = options.status;
    }

    const whereClause = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
    const rows = db
      .prepare(
        `SELECT t.id, t.session_id, t.name, t.status, t.trace_json, t.input_json, t.output,
                t.error_json, t.usage_json, t.metadata_json, t.observations_json,
                t.started_at, t.ended_at, t.duration_ms
         FROM runner_traces t
         LEFT JOIN runner_sessions s ON s.id = t.session_id
         ${whereClause}
         ORDER BY t.started_at DESC
         LIMIT $limit`,
      )
      .all(values) as TraceRow[];

    return rows.map(toTraceSummary);
  }

  listSessionTraces(options: StudioSessionTraceListOptions): StudioTraceSummary[] {
    const db = this.database();
    const rows = db
      .prepare(
        `SELECT id, session_id, name, status, trace_json, input_json, output, error_json,
                usage_json, metadata_json, observations_json, started_at, ended_at, duration_ms
         FROM runner_traces
         WHERE session_id = $sessionId
         ORDER BY started_at DESC
         LIMIT $limit`,
      )
      .all({
        $sessionId: options.sessionId,
        $limit: options.limit,
      }) as TraceRow[];

    return rows.map(toTraceSummary);
  }

  getTrace(id: string): StudioTrace | undefined {
    const db = this.database();
    const row = db
      .prepare(
        `SELECT id, session_id, name, status, trace_json, input_json, output, error_json,
                usage_json, metadata_json, observations_json, started_at, ended_at, duration_ms
         FROM runner_traces
         WHERE id = $id`,
      )
      .get({ $id: id }) as TraceRow | undefined;

    return row === undefined ? undefined : toTrace(row);
  }

  saveTrace(trace: StudioTrace): StudioTrace {
    const db = this.database();
    db.prepare(
      `INSERT INTO runner_traces (
        id,
        session_id,
        name,
        status,
        trace_json,
        input_json,
        output,
        error_json,
        usage_json,
        metadata_json,
        observations_json,
        started_at,
        ended_at,
        duration_ms
      ) VALUES (
        $id,
        $sessionId,
        $name,
        $status,
        $trace,
        $input,
        $output,
        $error,
        $usage,
        $metadata,
        $observations,
        $startedAt,
        $endedAt,
        $durationMs
      )
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        name = excluded.name,
        status = excluded.status,
        trace_json = excluded.trace_json,
        input_json = excluded.input_json,
        output = excluded.output,
        error_json = excluded.error_json,
        usage_json = excluded.usage_json,
        metadata_json = excluded.metadata_json,
        observations_json = excluded.observations_json,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        duration_ms = excluded.duration_ms`,
    ).run({
      $id: trace.id,
      $sessionId: trace.sessionId,
      $name: trace.name ?? null,
      $status: trace.status,
      $trace: trace.trace === undefined ? null : JSON.stringify(trace.trace),
      $input: trace.input === undefined ? null : JSON.stringify(trace.input),
      $output: trace.output ?? null,
      $error: trace.error === undefined ? null : JSON.stringify(trace.error),
      $usage: trace.usage === undefined ? null : JSON.stringify(trace.usage),
      $metadata: trace.metadata === undefined ? null : JSON.stringify(trace.metadata),
      $observations: JSON.stringify(trace.observations),
      $startedAt: trace.startedAt,
      $endedAt: trace.endedAt ?? null,
      $durationMs: trace.durationMs ?? null,
    });

    return trace;
  }

  private database(): DatabaseSyncType {
    if (this.db !== undefined) {
      return this.db;
    }

    if (this.path !== ":memory:") {
      mkdirSync(dirname(resolve(this.path)), { recursive: true });
    }

    const db = new DatabaseSync(this.path, {
      allowUnknownNamedParameters: true,
      timeout: 5000,
    });
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS runner_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata_json TEXT,
        messages_json TEXT NOT NULL,
        transcript_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS runner_sessions_agent_updated_idx
        ON runner_sessions(agent_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS runner_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL,
        trace_json TEXT,
        input_json TEXT,
        output TEXT,
        error_json TEXT,
        usage_json TEXT,
        metadata_json TEXT,
        observations_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS runner_traces_session_started_idx
        ON runner_traces(session_id, started_at DESC);
    `);

    this.db = db;
    return db;
  }
}

function toSession(row: SessionRow): StudioSession {
  const summary = toSessionSummary(row);
  return {
    ...summary,
    messages: parseJsonArray<Message>(row.messages_json),
    transcript: renumberTranscript(parseJsonArray<StudioTranscriptEntry>(row.transcript_json)),
  };
}

function toSessionSummary(row: SessionRow): StudioSessionSummary {
  const messages = parseJsonArray<Message>(row.messages_json);
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    id: row.id,
    agentId: row.agent_id,
    ...(row.title === null ? {} : { title: row.title }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: messages.length,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function toTrace(row: TraceRow): StudioTrace {
  const trace = parseJsonValue<StudioTrace["trace"]>(row.trace_json);
  const input = parseJsonValue<StudioTrace["input"]>(row.input_json);
  return {
    ...toTraceSummary(row),
    ...(trace === undefined ? {} : { trace }),
    ...(input === undefined ? {} : { input }),
    observations: parseJsonArray<StudioTrace["observations"][number]>(row.observations_json),
  };
}

function toTraceSummary(row: TraceRow): StudioTraceSummary {
  const observations = parseJsonArray<StudioTrace["observations"][number]>(row.observations_json);
  const error = parseJsonValue<StudioTraceSummary["error"]>(row.error_json);
  const usage = parseJsonValue<StudioTraceSummary["usage"]>(row.usage_json);
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.name === null ? {} : { name: row.name }),
    status: row.status,
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    ...(row.output === null ? {} : { output: row.output }),
    ...(error === undefined ? {} : { error }),
    ...(usage === undefined ? {} : { usage }),
    ...(metadata === undefined ? {} : { metadata }),
    observationCount: observations.length,
  };
}

function parseJsonArray<T>(value: string): T[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function parseJsonValue<T>(value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }
  return JSON.parse(value) as T;
}

function renumberTranscript(entries: StudioTranscriptEntry[]): StudioTranscriptEntry[] {
  return entries.map((entry, entryId) => ({ ...entry, entryId }));
}
