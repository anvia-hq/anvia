import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { renumberTranscript, transcriptFromMessages } from "../runtime/transcript";
import type {
  StudioPipelineLogAppendInput,
  StudioPipelineLogEntry,
  StudioPipelineLogListOptions,
  StudioPipelineLogStore,
  StudioPipelineRunListOptions,
  StudioPipelineRunRecord,
  StudioPipelineRunSaveInput,
  StudioPipelineRunStore,
  StudioSession,
  StudioSessionCreateInput,
  StudioSessionListOptions,
  StudioSessionLogAppendInput,
  StudioSessionLogEntry,
  StudioSessionLogListOptions,
  StudioSessionRunStatus,
  StudioSessionRunTranscriptInput,
  StudioSessionStore,
  StudioSessionSummary,
  StudioSessionTraceListOptions,
  StudioTrace,
  StudioTraceListOptions,
  StudioTraceStore,
  StudioTraceSummary,
  StudioTranscriptEntry,
} from "../types";

export type SqliteSessionStoreOptions = {
  path?: string;
};

type DatabaseSyncConstructor = typeof DatabaseSyncType;

let DatabaseSync: DatabaseSyncConstructor | undefined;

type SessionRow = {
  id: string;
  agent_id: string;
  title: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type SessionSummaryRow = SessionRow & {
  message_count: number;
};

type MessageRow = {
  session_id: string;
  message_index: number;
  role: Message["role"];
  message_id: string | null;
  created_at: string;
};

type MessagePartRow = {
  session_id: string;
  message_index: number;
  part_index: number;
  type: string;
  part_json: string;
};

type StoredMessagePart = {
  type: string;
  value: unknown;
};

type TableInfoRow = {
  name: string;
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

type SessionRunRow = {
  run_id: string;
  session_id: string;
  status: StudioSessionRunStatus;
  title: string | null;
  transcript_json: string;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

type SessionLogRow = {
  id: string;
  session_id: string;
  run_id: string | null;
  sequence: number;
  timestamp: string;
  level: StudioSessionLogEntry["level"];
  category: StudioSessionLogEntry["category"];
  event: string;
  message: string;
  metadata_json: string | null;
};

type PipelineLogRow = {
  id: string;
  pipeline_id: string;
  run_id: string | null;
  sequence: number;
  timestamp: string;
  level: StudioPipelineLogEntry["level"];
  category: StudioPipelineLogEntry["category"];
  event: string;
  message: string;
  metadata_json: string | null;
};

type PipelineRunRow = {
  run_id: string;
  pipeline_id: string;
  status: StudioPipelineRunRecord["status"];
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  metadata_json: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
};

export function createSqliteSessionStore(
  options: SqliteSessionStoreOptions = {},
): StudioSessionStore & StudioTraceStore & StudioPipelineLogStore & StudioPipelineRunStore {
  return new SqliteSessionStore(options.path ?? ":memory:");
}

class SqliteSessionStore
  implements StudioSessionStore, StudioTraceStore, StudioPipelineLogStore, StudioPipelineRunStore
{
  readonly kind = "sqlite";
  private db: DatabaseSyncType | undefined;

  constructor(private readonly path: string) {}

  listSessions(options: StudioSessionListOptions): StudioSessionSummary[] {
    const db = this.database();
    const agentClause = options.agentId === undefined ? "" : "WHERE s.agent_id = $agentId";
    const rows = db
      .prepare(
        `SELECT s.id, s.agent_id, s.title, s.metadata_json, s.created_at, s.updated_at,
                COUNT(m.message_index) AS message_count
         FROM anvia_studio_sessions s
         LEFT JOIN anvia_studio_session_messages m ON m.session_id = s.id
         ${agentClause}
         GROUP BY s.id, s.agent_id, s.title, s.metadata_json, s.created_at, s.updated_at
         ORDER BY s.updated_at DESC
         LIMIT $limit`,
      )
      .all({
        $agentId: options.agentId ?? null,
        $limit: options.limit,
      }) as SessionSummaryRow[];

    return rows.map(toSessionSummary);
  }

  createSession(input: StudioSessionCreateInput): StudioSessionSummary {
    const db = this.database();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO anvia_studio_sessions (
        id,
        agent_id,
        title,
        metadata_json,
        created_at,
        updated_at
      ) VALUES ($id, $agentId, $title, $metadata, $now, $now)`,
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
    const row = this.getSessionRow(id);

    return row === undefined
      ? undefined
      : toSession(row, this.listSessionMessages(id), this.listSessionRunRows(id));
  }

  updateSessionMetadata(id: string, metadata: JsonObject | undefined): StudioSession | undefined {
    const db = this.database();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE anvia_studio_sessions
         SET metadata_json = $metadata,
             updated_at = $now
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $metadata: metadata === undefined ? null : JSON.stringify(metadata),
        $now: now,
      });
    if (result.changes === 0) {
      return undefined;
    }
    return this.getSession(id);
  }

  load(context: MemoryContext): Promise<Message[]> {
    const session = this.getSession(context.sessionId);
    return Promise.resolve(session?.messages ?? []);
  }

  append(input: MemoryAppendInput): Promise<void> {
    const db = this.database();

    try {
      db.exec("BEGIN IMMEDIATE");
      const row = db
        .prepare(
          `SELECT id, agent_id, title, metadata_json, created_at, updated_at
           FROM anvia_studio_sessions
           WHERE id = $id`,
        )
        .get({ $id: input.context.sessionId }) as SessionRow | undefined;

      if (row === undefined) {
        db.exec("ROLLBACK");
        return Promise.resolve();
      }

      const updatedAt = new Date().toISOString();
      const nextIndex = this.nextMessageIndex(input.context.sessionId);

      this.insertMessages(input.context.sessionId, input.messages, nextIndex, updatedAt);
      db.prepare(
        `UPDATE anvia_studio_sessions
         SET updated_at = $updatedAt
         WHERE id = $id`,
      ).run({
        $id: input.context.sessionId,
        $updatedAt: updatedAt,
      });
      db.exec("COMMIT");
      return Promise.resolve();
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  clear(context: MemoryContext): Promise<void> {
    const db = this.database();
    const updatedAt = new Date().toISOString();

    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        `UPDATE anvia_studio_sessions
         SET updated_at = $updatedAt
         WHERE id = $id`,
      ).run({
        $id: context.sessionId,
        $updatedAt: updatedAt,
      });
      db.prepare("DELETE FROM anvia_studio_session_messages WHERE session_id = $id").run({
        $id: context.sessionId,
      });
      db.prepare("DELETE FROM anvia_studio_session_runs WHERE session_id = $id").run({
        $id: context.sessionId,
      });
      db.exec("COMMIT");
      return Promise.resolve();
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    const runId = studioRunId(input.context) ?? input.runId;
    const existing = this.getSessionRun(input.context.sessionId, runId);
    const transcript =
      existing === undefined ||
      parseJsonArray<StudioTranscriptEntry>(existing.transcript_json).length === 0
        ? transcriptFromMessages(input.messages)
        : parseJsonArray<StudioTranscriptEntry>(existing.transcript_json);
    await this.saveSessionRunTranscript({
      id: input.context.sessionId,
      runId,
      transcript,
      status: "error",
      error: serializeJsonError(input.error),
    });
  }

  saveSessionRunTranscript(input: StudioSessionRunTranscriptInput): StudioSession | undefined {
    const db = this.database();
    const now = new Date().toISOString();

    try {
      db.exec("BEGIN IMMEDIATE");
      const row = this.getSessionRow(input.id);
      if (row === undefined) {
        db.exec("ROLLBACK");
        return undefined;
      }
      const current = toSession(
        row,
        this.listSessionMessages(input.id),
        this.listSessionRunRows(input.id),
      );
      const title = current.title ?? input.title;

      db.prepare(
        `INSERT INTO anvia_studio_session_runs (
          run_id,
          session_id,
          status,
          title,
          transcript_json,
          error_json,
          created_at,
          updated_at
        ) VALUES (
          $runId,
          $sessionId,
          $status,
          $title,
          $transcript,
          $error,
          $now,
          $now
        )
        ON CONFLICT(run_id) DO UPDATE SET
          status = excluded.status,
          title = COALESCE(anvia_studio_session_runs.title, excluded.title),
          transcript_json = excluded.transcript_json,
          error_json = excluded.error_json,
          updated_at = excluded.updated_at`,
      ).run({
        $runId: input.runId,
        $sessionId: input.id,
        $status: input.status,
        $title: input.title ?? null,
        $transcript: JSON.stringify(renumberTranscript(input.transcript)),
        $error: input.error === undefined ? null : JSON.stringify(input.error),
        $now: now,
      });

      db.prepare(
        `UPDATE anvia_studio_sessions
         SET title = $title,
             updated_at = $updatedAt
         WHERE id = $id`,
      ).run({
        $id: input.id,
        $title: title ?? null,
        $updatedAt: now,
      });
      db.exec("COMMIT");

      const updated = this.getSession(input.id);
      return updated;
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  appendSessionLog(input: StudioSessionLogAppendInput): StudioSessionLogEntry {
    const db = this.database();
    const now = new Date().toISOString();

    try {
      db.exec("BEGIN IMMEDIATE");
      const row = this.getSessionRow(input.sessionId);
      if (row === undefined) {
        throw new Error("Session not found");
      }
      const sequence = this.nextSessionLogSequence(input.sessionId);
      const entry: StudioSessionLogEntry = {
        id: globalThis.crypto.randomUUID(),
        sessionId: input.sessionId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        sequence,
        timestamp: now,
        level: input.level,
        category: input.category,
        event: input.event,
        message: input.message,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      };

      db.prepare(
        `INSERT INTO anvia_studio_session_logs (
          id,
          session_id,
          run_id,
          sequence,
          timestamp,
          level,
          category,
          event,
          message,
          metadata_json
        ) VALUES (
          $id,
          $sessionId,
          $runId,
          $sequence,
          $timestamp,
          $level,
          $category,
          $event,
          $message,
          $metadata
        )`,
      ).run({
        $id: entry.id,
        $sessionId: entry.sessionId,
        $runId: entry.runId ?? null,
        $sequence: entry.sequence,
        $timestamp: entry.timestamp,
        $level: entry.level,
        $category: entry.category,
        $event: entry.event,
        $message: entry.message,
        $metadata: entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      });

      db.exec("COMMIT");
      return entry;
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  listSessionLogs(options: StudioSessionLogListOptions): StudioSessionLogEntry[] {
    const db = this.database();
    const afterClause = options.after === undefined ? "" : "AND sequence > $after";
    const rows = db
      .prepare(
        `SELECT id, session_id, run_id, sequence, timestamp, level, category, event, message,
                metadata_json
         FROM anvia_studio_session_logs
         WHERE session_id = $sessionId
         ${afterClause}
         ORDER BY sequence ASC
         LIMIT $limit`,
      )
      .all({
        $sessionId: options.sessionId,
        $after: options.after ?? null,
        $limit: options.limit,
      }) as SessionLogRow[];

    return rows.map(toSessionLog);
  }

  appendPipelineLog(input: StudioPipelineLogAppendInput): StudioPipelineLogEntry {
    const db = this.database();
    const now = new Date().toISOString();

    try {
      db.exec("BEGIN IMMEDIATE");
      const sequence = this.nextPipelineLogSequence(input.pipelineId);
      const entry: StudioPipelineLogEntry = {
        id: globalThis.crypto.randomUUID(),
        pipelineId: input.pipelineId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        sequence,
        timestamp: now,
        level: input.level,
        category: input.category,
        event: input.event,
        message: input.message,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      };

      db.prepare(
        `INSERT INTO anvia_studio_pipeline_logs (
          id,
          pipeline_id,
          run_id,
          sequence,
          timestamp,
          level,
          category,
          event,
          message,
          metadata_json
        ) VALUES (
          $id,
          $pipelineId,
          $runId,
          $sequence,
          $timestamp,
          $level,
          $category,
          $event,
          $message,
          $metadata
        )`,
      ).run({
        $id: entry.id,
        $pipelineId: entry.pipelineId,
        $runId: entry.runId ?? null,
        $sequence: entry.sequence,
        $timestamp: entry.timestamp,
        $level: entry.level,
        $category: entry.category,
        $event: entry.event,
        $message: entry.message,
        $metadata: entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      });

      db.exec("COMMIT");
      return entry;
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  listPipelineLogs(options: StudioPipelineLogListOptions): StudioPipelineLogEntry[] {
    const db = this.database();
    const afterClause = options.after === undefined ? "" : "AND sequence > $after";
    const rows = db
      .prepare(
        `SELECT id, pipeline_id, run_id, sequence, timestamp, level, category, event, message,
                metadata_json
         FROM anvia_studio_pipeline_logs
         WHERE pipeline_id = $pipelineId
         ${afterClause}
         ORDER BY sequence ASC
         LIMIT $limit`,
      )
      .all({
        $pipelineId: options.pipelineId,
        $after: options.after ?? null,
        $limit: options.limit,
      }) as PipelineLogRow[];

    return rows.map(toPipelineLog);
  }

  savePipelineRun(input: StudioPipelineRunSaveInput): StudioPipelineRunRecord {
    const db = this.database();
    db.prepare(
      `INSERT INTO anvia_studio_pipeline_runs (
        run_id,
        pipeline_id,
        status,
        input_json,
        output_json,
        error_json,
        metadata_json,
        started_at,
        ended_at,
        duration_ms
      ) VALUES (
        $runId,
        $pipelineId,
        $status,
        $input,
        $output,
        $error,
        $metadata,
        $startedAt,
        $endedAt,
        $durationMs
      )
      ON CONFLICT(run_id) DO UPDATE SET
        pipeline_id = excluded.pipeline_id,
        status = excluded.status,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        duration_ms = excluded.duration_ms`,
    ).run({
      $runId: input.runId,
      $pipelineId: input.pipelineId,
      $status: input.status,
      $input: JSON.stringify(input.input),
      $output: input.output === undefined ? null : JSON.stringify(input.output),
      $error: input.error === undefined ? null : JSON.stringify(input.error),
      $metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
      $startedAt: input.startedAt,
      $endedAt: input.endedAt ?? null,
      $durationMs: input.durationMs ?? null,
    });

    return {
      runId: input.runId,
      pipelineId: input.pipelineId,
      status: input.status,
      input: input.input,
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      startedAt: input.startedAt,
      ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    };
  }

  getPipelineRun(options: {
    pipelineId: string;
    runId: string;
  }): StudioPipelineRunRecord | undefined {
    const db = this.database();
    const row = db
      .prepare(
        `SELECT run_id, pipeline_id, status, input_json, output_json, error_json,
                metadata_json, started_at, ended_at, duration_ms
         FROM anvia_studio_pipeline_runs
         WHERE pipeline_id = $pipelineId AND run_id = $runId`,
      )
      .get({
        $pipelineId: options.pipelineId,
        $runId: options.runId,
      }) as PipelineRunRow | undefined;

    return row === undefined ? undefined : toPipelineRun(row);
  }

  listPipelineRuns(options: StudioPipelineRunListOptions): StudioPipelineRunRecord[] {
    const db = this.database();
    const rows = db
      .prepare(
        `SELECT run_id, pipeline_id, status, input_json, output_json, error_json,
                metadata_json, started_at, ended_at, duration_ms
         FROM anvia_studio_pipeline_runs
         WHERE pipeline_id = $pipelineId
         ORDER BY started_at DESC
         LIMIT $limit`,
      )
      .all({
        $pipelineId: options.pipelineId,
        $limit: options.limit,
      }) as PipelineRunRow[];

    return rows.map(toPipelineRun);
  }

  deleteSession(id: string): boolean {
    const db = this.database();

    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("DELETE FROM anvia_studio_traces WHERE session_id = $id").run({ $id: id });
      db.prepare("DELETE FROM anvia_studio_session_runs WHERE session_id = $id").run({ $id: id });
      db.prepare("DELETE FROM anvia_studio_session_logs WHERE session_id = $id").run({ $id: id });
      const result = db
        .prepare("DELETE FROM anvia_studio_sessions WHERE id = $id")
        .run({ $id: id }) as {
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
         FROM anvia_studio_traces t
         LEFT JOIN anvia_studio_sessions s ON s.id = t.session_id
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
         FROM anvia_studio_traces
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
         FROM anvia_studio_traces
         WHERE id = $id`,
      )
      .get({ $id: id }) as TraceRow | undefined;

    return row === undefined ? undefined : toTrace(row);
  }

  saveTrace(trace: StudioTrace): StudioTrace {
    const db = this.database();
    db.prepare(
      `INSERT INTO anvia_studio_traces (
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

    const db = new (loadDatabaseSync())(this.path, {
      allowUnknownNamedParameters: true,
      timeout: 5000,
    });
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
    guardAgainstLegacySessionSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS anvia_studio_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_sessions_agent_updated_idx
        ON anvia_studio_sessions(agent_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS anvia_studio_session_messages (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, message_index),
        FOREIGN KEY(session_id) REFERENCES anvia_studio_sessions(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_session_messages_session_idx
        ON anvia_studio_session_messages(session_id, message_index ASC);
      CREATE TABLE IF NOT EXISTS anvia_studio_session_message_parts (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        part_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        part_json TEXT NOT NULL,
        PRIMARY KEY(session_id, message_index, part_index),
        FOREIGN KEY(session_id, message_index)
          REFERENCES anvia_studio_session_messages(session_id, message_index)
          ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS anvia_studio_session_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        transcript_json TEXT NOT NULL,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES anvia_studio_sessions(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_session_runs_session_created_idx
        ON anvia_studio_session_runs(session_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS anvia_studio_session_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        event TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT,
        UNIQUE(session_id, sequence),
        FOREIGN KEY(session_id) REFERENCES anvia_studio_sessions(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_session_logs_session_sequence_idx
        ON anvia_studio_session_logs(session_id, sequence ASC);
      CREATE TABLE IF NOT EXISTS anvia_studio_pipeline_logs (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        event TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT,
        UNIQUE(pipeline_id, sequence)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_pipeline_logs_pipeline_sequence_idx
        ON anvia_studio_pipeline_logs(pipeline_id, sequence ASC);
      CREATE TABLE IF NOT EXISTS anvia_studio_pipeline_runs (
        run_id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        metadata_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS anvia_studio_pipeline_runs_pipeline_started_idx
        ON anvia_studio_pipeline_runs(pipeline_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS anvia_studio_traces (
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
      CREATE INDEX IF NOT EXISTS anvia_studio_traces_session_started_idx
        ON anvia_studio_traces(session_id, started_at DESC);
    `);

    this.db = db;
    return db;
  }

  private getSessionRow(id: string): SessionRow | undefined {
    return this.database()
      .prepare(
        `SELECT id, agent_id, title, metadata_json, created_at, updated_at
         FROM anvia_studio_sessions
         WHERE id = $id`,
      )
      .get({ $id: id }) as SessionRow | undefined;
  }

  private getSessionRun(sessionId: string, runId: string): SessionRunRow | undefined {
    return this.database()
      .prepare(
        `SELECT run_id, session_id, status, title, transcript_json, error_json, created_at, updated_at
         FROM anvia_studio_session_runs
         WHERE session_id = $sessionId AND run_id = $runId`,
      )
      .get({ $sessionId: sessionId, $runId: runId }) as SessionRunRow | undefined;
  }

  private listSessionRunRows(sessionId: string): SessionRunRow[] {
    return this.database()
      .prepare(
        `SELECT run_id, session_id, status, title, transcript_json, error_json, created_at, updated_at
         FROM anvia_studio_session_runs
         WHERE session_id = $sessionId
         ORDER BY created_at ASC`,
      )
      .all({ $sessionId: sessionId }) as SessionRunRow[];
  }

  private nextSessionLogSequence(sessionId: string): number {
    const row = this.database()
      .prepare(
        `SELECT COALESCE(MAX(sequence) + 1, 0) AS next_sequence
         FROM anvia_studio_session_logs
         WHERE session_id = $sessionId`,
      )
      .get({ $sessionId: sessionId }) as { next_sequence: number };
    return row.next_sequence;
  }

  private nextPipelineLogSequence(pipelineId: string): number {
    const row = this.database()
      .prepare(
        `SELECT COALESCE(MAX(sequence) + 1, 0) AS next_sequence
         FROM anvia_studio_pipeline_logs
         WHERE pipeline_id = $pipelineId`,
      )
      .get({ $pipelineId: pipelineId }) as { next_sequence: number };
    return row.next_sequence;
  }

  private listSessionMessages(sessionId: string): Message[] {
    const db = this.database();
    const messageRows = db
      .prepare(
        `SELECT session_id, message_index, role, message_id, created_at
         FROM anvia_studio_session_messages
         WHERE session_id = $sessionId
         ORDER BY message_index ASC`,
      )
      .all({ $sessionId: sessionId }) as MessageRow[];

    if (messageRows.length === 0) {
      return [];
    }

    const partRows = db
      .prepare(
        `SELECT session_id, message_index, part_index, type, part_json
         FROM anvia_studio_session_message_parts
         WHERE session_id = $sessionId
         ORDER BY message_index ASC, part_index ASC`,
      )
      .all({ $sessionId: sessionId }) as MessagePartRow[];
    const partsByMessage = new Map<number, MessagePartRow[]>();
    for (const partRow of partRows) {
      const parts = partsByMessage.get(partRow.message_index) ?? [];
      parts.push(partRow);
      partsByMessage.set(partRow.message_index, parts);
    }

    return messageRows.map((row) =>
      messageFromRows(row, partsByMessage.get(row.message_index) ?? []),
    );
  }

  private nextMessageIndex(sessionId: string): number {
    const row = this.database()
      .prepare(
        `SELECT COALESCE(MAX(message_index) + 1, 0) AS next_index
         FROM anvia_studio_session_messages
         WHERE session_id = $sessionId`,
      )
      .get({ $sessionId: sessionId }) as { next_index: number };
    return row.next_index;
  }

  private insertMessages(
    sessionId: string,
    messages: Message[],
    startIndex: number,
    createdAt: string,
  ): void {
    const db = this.database();
    const insertMessage = db.prepare(
      `INSERT INTO anvia_studio_session_messages (
        session_id,
        message_index,
        role,
        message_id,
        created_at
      ) VALUES ($sessionId, $messageIndex, $role, $messageId, $createdAt)`,
    );
    const insertPart = db.prepare(
      `INSERT INTO anvia_studio_session_message_parts (
        session_id,
        message_index,
        part_index,
        type,
        part_json
      ) VALUES ($sessionId, $messageIndex, $partIndex, $type, $partJson)`,
    );

    messages.forEach((message, messageOffset) => {
      const messageIndex = startIndex + messageOffset;
      insertMessage.run({
        $sessionId: sessionId,
        $messageIndex: messageIndex,
        $role: message.role,
        $messageId: message.role === "assistant" ? (message.id ?? null) : null,
        $createdAt: createdAt,
      });

      messageParts(message).forEach((part, partIndex) => {
        insertPart.run({
          $sessionId: sessionId,
          $messageIndex: messageIndex,
          $partIndex: partIndex,
          $type: part.type,
          $partJson: JSON.stringify(part.value),
        });
      });
    });
  }
}

function toSession(
  row: SessionRow,
  messages: Message[],
  runRows: SessionRunRow[] = [],
): StudioSession {
  const summary = toSessionSummary({ ...row, message_count: messages.length });
  const runTranscript = runRows.flatMap((runRow) =>
    parseJsonArray<StudioTranscriptEntry>(runRow.transcript_json),
  );
  return {
    ...summary,
    messages,
    transcript: renumberTranscript(runTranscript),
  };
}

function toSessionSummary(row: SessionSummaryRow): StudioSessionSummary {
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    id: row.id,
    agentId: row.agent_id,
    ...(row.title === null ? {} : { title: row.title }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function toSessionLog(row: SessionLogRow): StudioSessionLogEntry {
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    sequence: row.sequence,
    timestamp: row.timestamp,
    level: row.level,
    category: row.category,
    event: row.event,
    message: row.message,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function toPipelineLog(row: PipelineLogRow): StudioPipelineLogEntry {
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    sequence: row.sequence,
    timestamp: row.timestamp,
    level: row.level,
    category: row.category,
    event: row.event,
    message: row.message,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function toPipelineRun(row: PipelineRunRow): StudioPipelineRunRecord {
  const output = parseJsonValue<JsonValue>(row.output_json);
  const error = parseJsonValue<JsonValue>(row.error_json);
  const metadata = parseJsonValue<JsonObject>(row.metadata_json);
  return {
    runId: row.run_id,
    pipelineId: row.pipeline_id,
    status: row.status,
    input: JSON.parse(row.input_json) as JsonValue,
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    ...(metadata === undefined ? {} : { metadata }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
  };
}

function messageParts(message: Message): StoredMessagePart[] {
  if (message.role === "system") {
    return [{ type: "text", value: { type: "text", text: message.content } }];
  }

  return message.content.map((content) => ({
    type: content.type,
    value: content,
  }));
}

function messageFromRows(row: MessageRow, partRows: MessagePartRow[]): Message {
  const parts = partRows.map((partRow) => JSON.parse(partRow.part_json) as unknown);

  if (row.role === "system") {
    return { role: "system", content: systemContentFromParts(parts) };
  }
  if (row.role === "user") {
    return {
      role: "user",
      content: parts as Extract<Message, { role: "user" }>["content"],
    };
  }
  if (row.role === "assistant") {
    return {
      role: "assistant",
      ...(row.message_id === null ? {} : { id: row.message_id }),
      content: parts as Extract<Message, { role: "assistant" }>["content"],
    };
  }
  if (row.role === "tool") {
    return {
      role: "tool",
      content: parts as Extract<Message, { role: "tool" }>["content"],
    };
  }

  throw new Error(`Unsupported stored message role: ${row.role}`);
}

function systemContentFromParts(parts: unknown[]): string {
  const first = parts[0];
  if (
    typeof first === "object" &&
    first !== null &&
    "type" in first &&
    first.type === "text" &&
    "text" in first &&
    typeof first.text === "string"
  ) {
    return first.text;
  }
  return "";
}

function guardAgainstLegacySessionSchema(db: DatabaseSyncType): void {
  const columns = db.prepare("PRAGMA table_info('anvia_studio_sessions')").all() as TableInfoRow[];
  if (columns.some((column) => column.name === "messages_json")) {
    throw new Error(
      "Existing Studio SQLite DB uses the legacy messages_json schema. Delete or recreate the Studio SQLite DB to use normalized session messages.",
    );
  }
}

function loadDatabaseSync(): DatabaseSyncConstructor {
  if (DatabaseSync !== undefined) {
    return DatabaseSync;
  }

  try {
    ({ DatabaseSync } = createRequire(import.meta.url)(
      "node:sqlite",
    ) as typeof import("node:sqlite"));
    return DatabaseSync;
  } catch (error) {
    throw new Error(
      "The default Studio SQLite store requires Node.js with node:sqlite support. Provide custom Studio stores or disable persisted stores when running Studio in a runtime without node:sqlite.",
      { cause: error },
    );
  }
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

function studioRunId(context: MemoryContext): string | undefined {
  const value = context.metadata?.studioRunId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function serializeJsonError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  if (
    error === null ||
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return error;
  }
  return String(error);
}
