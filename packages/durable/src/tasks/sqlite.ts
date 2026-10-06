import type { DatabaseSync } from "node:sqlite";
import { parseTask, taskListSchema } from "./schema.js";
import type { TaskListOptions, TaskPage, TaskRecord, TaskTransaction } from "./types.js";

export const taskTables = `
  CREATE TABLE IF NOT EXISTS anvia_durable_tasks (
    id TEXT PRIMARY KEY, root_id TEXT NOT NULL, parent_id TEXT NOT NULL,
    session_id TEXT NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL, ready_order INTEGER NOT NULL, record TEXT NOT NULL,
    UNIQUE(session_id, parent_id, key)
  );
  CREATE INDEX IF NOT EXISTS anvia_durable_task_root ON anvia_durable_tasks(root_id);
  CREATE INDEX IF NOT EXISTS anvia_durable_task_parent ON anvia_durable_tasks(parent_id);
  CREATE INDEX IF NOT EXISTS anvia_durable_task_status ON anvia_durable_tasks(status);
`;

export function taskTransaction(db: DatabaseSync, assertActive: () => void): TaskTransaction {
  const read = (sql: string, ...parameters: string[]): TaskRecord[] => {
    assertActive();
    return db
      .prepare(sql)
      .all(...parameters)
      .map((row) => parseTask(JSON.parse(String(row.record))));
  };
  return {
    getTask: (id) => read("SELECT record FROM anvia_durable_tasks WHERE id = ?", id)[0],
    findTask: (session, parent, key) =>
      read(
        "SELECT record FROM anvia_durable_tasks WHERE session_id = ? AND parent_id = ? AND key = ?",
        session,
        parent ?? "",
        key,
      )[0],
    taskChildren: (id) =>
      read("SELECT record FROM anvia_durable_tasks WHERE parent_id = ? ORDER BY rowid", id),
    taskTree: (root) =>
      read("SELECT record FROM anvia_durable_tasks WHERE root_id = ? ORDER BY rowid", root),
    putTask: (value) => {
      assertActive();
      const task = parseTask(value);
      db.prepare(`INSERT INTO anvia_durable_tasks(id, root_id, parent_id, session_id, key, status, record, ready_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM anvia_durable_events))
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, record = excluded.record, ready_order = excluded.ready_order`).run(
        task.id,
        task.rootId,
        task.parentId ?? "",
        task.sessionId,
        task.key,
        task.status,
        JSON.stringify(task),
      );
    },
  };
}

export function listTasks(db: DatabaseSync, input: TaskListOptions): TaskPage {
  const options = taskListSchema.parse(input);
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`SELECT rowid AS cursor, record FROM anvia_durable_tasks WHERE parent_id = ''
    AND rowid > ? ${options.sessionId === undefined ? "" : "AND session_id = ?"} ORDER BY rowid LIMIT ?`)
    .all(
      options.after ?? 0,
      ...(options.sessionId === undefined ? [] : [options.sessionId]),
      limit + 1,
    );
  const page = rows.slice(0, limit);
  return {
    tasks: page.map((row) => parseTask(JSON.parse(String(row.record)))),
    ...(rows.length > limit ? { nextCursor: Number(page.at(-1)!.cursor) } : {}),
  };
}

export function scheduleTasks(
  db: DatabaseSync,
  excluded: readonly string[],
  limit: number,
): string[] {
  const filter =
    excluded.length === 0 ? "" : `AND id NOT IN (${excluded.map(() => "?").join(",")})`;
  return db
    .prepare(
      `SELECT id FROM anvia_durable_tasks WHERE status IN ('pending', 'running') ${filter} ORDER BY ready_order, rowid LIMIT ?`,
    )
    .all(...excluded, limit)
    .map((row) => String(row.id));
}

export function unsettledTaskRoots(
  db: DatabaseSync,
  after: number,
): { ids: string[]; cursor?: number } {
  const rows = db
    .prepare(`SELECT rowid AS cursor, id FROM anvia_durable_tasks
    WHERE parent_id = '' AND status NOT IN ('completed', 'failed', 'cancelled') AND rowid > ? ORDER BY rowid LIMIT 100`)
    .all(after);
  return {
    ids: rows.map((row) => String(row.id)),
    ...(rows.length === 100 ? { cursor: Number(rows.at(-1)!.cursor) } : {}),
  };
}
