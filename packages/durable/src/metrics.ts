import type { DatabaseSync } from "node:sqlite";

export type DurableMetrics = {
  observedAt: string;
  runs: Record<string, number>;
  tasks: Record<string, number>;
  oldestPendingAgeMs: number;
  operations: number;
  events: number;
  databaseBytes: number;
};

/** Aggregate only: no session identifiers, prompts, checkpoints, or outputs. */
export function sqliteMetrics(db: DatabaseSync): DurableMetrics {
  const statuses = (table: string) =>
    Object.fromEntries(
      db
        .prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`)
        .all()
        .map((row) => [String(row.status), Number(row.n)]),
    );
  const oldest = db
    .prepare(`SELECT MIN(created) AS oldest FROM (
    SELECT MIN(json_extract(record, '$.createdAt')) AS created FROM anvia_durable_runs WHERE status NOT IN ('completed', 'failed', 'cancelled')
    UNION ALL SELECT MIN(json_extract(record, '$.createdAt')) FROM anvia_durable_tasks WHERE status NOT IN ('completed', 'failed', 'cancelled')
  )`)
    .get()!.oldest;
  const count = (table: string) =>
    Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  return {
    observedAt: new Date().toISOString(),
    runs: statuses("anvia_durable_runs"),
    tasks: statuses("anvia_durable_tasks"),
    oldestPendingAgeMs:
      typeof oldest === "string" ? Math.max(0, Date.now() - Date.parse(oldest)) : 0,
    operations: count("anvia_durable_operations"),
    events: count("anvia_durable_events"),
    databaseBytes:
      Number(db.prepare("PRAGMA page_count").get()!.page_count) *
      Number(db.prepare("PRAGMA page_size").get()!.page_size),
  };
}
