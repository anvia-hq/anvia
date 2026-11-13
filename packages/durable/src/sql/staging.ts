import type { BlobBackend } from "../blob.js";
import type { MessageBackend } from "../message-log.js";
import type { SqlQuery } from "./driver.js";

/** A synchronous read hit a row that has not been loaded into the staging area yet. */
export class MissingRow extends Error {
  constructor(
    readonly kind: "blob" | "history",
    readonly hash: string,
  ) {
    super(`Durable ${kind} row not staged: ${hash}`);
  }
}

type Blob = { bytes: number; record: string };
type History = { previous: string | null; message: string };

/**
 * Lets the synchronous blob and message-log code run over an async database. Reads come from rows
 * loaded beforehand; a read of an unloaded row throws `MissingRow`, `run` loads it and calls the
 * code again. Writes are collected and flushed with the caller's transaction. Rows are content
 * addressed and immutable, so repeating a read or a write is harmless. One instance serves one
 * transaction or one read.
 */
export class Staging implements BlobBackend, MessageBackend {
  private readonly blobs = new Map<string, Blob | null>();
  private readonly messages = new Map<string, string>();
  private readonly histories = new Map<string, History | null>();
  private readonly newBlobs = new Map<string, Blob>();
  private readonly newMessages = new Map<string, string>();
  private readonly newHistories = new Map<string, History>();

  put(hash: string, bytes: number, record: string): void {
    this.blobs.set(hash, { bytes, record });
    this.newBlobs.set(hash, { bytes, record });
  }

  get(hash: string): Blob | undefined {
    const row = this.blobs.get(hash);
    if (row === undefined) throw new MissingRow("blob", hash);
    return row ?? undefined;
  }

  putMessage(hash: string, record: string): void {
    this.messages.set(hash, record);
    this.newMessages.set(hash, record);
  }

  putHistory(hash: string, previous: string | null, message: string): void {
    this.histories.set(hash, { previous, message });
    this.newHistories.set(hash, { previous, message });
  }

  getHistory(hash: string) {
    const row = this.histories.get(hash);
    if (row === undefined) throw new MissingRow("history", hash);
    if (row === null) return undefined;
    const record = this.messages.get(row.message);
    if (record === undefined) throw new MissingRow("history", hash);
    return { previous: row.previous, message: row.message, record };
  }

  /** Runs `fn`, loading whatever it asks for, then writes what it staged. */
  async run<T>(query: SqlQuery, fn: () => T): Promise<T> {
    for (;;) {
      let result: T;
      try {
        result = fn();
      } catch (error) {
        if (!(error instanceof MissingRow)) throw error;
        await this.load(query, error);
        continue;
      }
      await this.flush(query);
      return result;
    }
  }

  private async load(query: SqlQuery, missing: MissingRow): Promise<void> {
    if (missing.kind === "blob") {
      const rows = await query(
        "SELECT bytes::text AS bytes, record FROM anvia_durable_blobs WHERE hash = $1::text",
        [missing.hash],
      );
      const row = rows[0];
      this.blobs.set(
        missing.hash,
        row === undefined ? null : { bytes: Number(row.bytes), record: String(row.record) },
      );
      return;
    }
    const rows = await query(
      `WITH RECURSIVE chain(hash, previous, message) AS (
         SELECT hash, previous, message FROM anvia_durable_histories WHERE hash = $1::text
         UNION ALL
         SELECT h.hash, h.previous, h.message FROM anvia_durable_histories h
         JOIN chain c ON h.hash = c.previous
       )
       SELECT c.hash, c.previous, c.message, m.record FROM chain c
       LEFT JOIN anvia_durable_messages m ON m.hash = c.message`,
      [missing.hash],
    );
    if (rows.length === 0) this.histories.set(missing.hash, null);
    for (const row of rows) {
      const hash = String(row.hash);
      const message = String(row.message);
      this.histories.set(hash, {
        previous: row.previous === null ? null : String(row.previous),
        message,
      });
      if (row.record !== null) this.messages.set(message, String(row.record));
    }
  }

  private async flush(query: SqlQuery): Promise<void> {
    if (this.newMessages.size > 0) {
      const rows = [...this.newMessages].map(([hash, record]) => ({ hash, record }));
      this.newMessages.clear();
      await query(
        `INSERT INTO anvia_durable_messages(hash, record)
         SELECT x.hash, x.record FROM jsonb_to_recordset($1::text::jsonb) AS x(hash text, record text)
         ON CONFLICT (hash) DO NOTHING`,
        [JSON.stringify(rows)],
      );
    }
    if (this.newHistories.size > 0) {
      const rows = [...this.newHistories].map(([hash, row]) => ({ hash, ...row }));
      this.newHistories.clear();
      await query(
        `INSERT INTO anvia_durable_histories(hash, previous, message)
         SELECT x.hash, x.previous, x.message
         FROM jsonb_to_recordset($1::text::jsonb) AS x(hash text, previous text, message text)
         ON CONFLICT (hash) DO NOTHING`,
        [JSON.stringify(rows)],
      );
    }
    if (this.newBlobs.size > 0) {
      const rows = [...this.newBlobs].map(([hash, row]) => ({ hash, ...row }));
      this.newBlobs.clear();
      await query(
        `INSERT INTO anvia_durable_blobs(hash, bytes, record)
         SELECT x.hash, x.bytes, x.record
         FROM jsonb_to_recordset($1::text::jsonb) AS x(hash text, bytes bigint, record text)
         ON CONFLICT (hash) DO NOTHING`,
        [JSON.stringify(rows)],
      );
    }
  }
}
