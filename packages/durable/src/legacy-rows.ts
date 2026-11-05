import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { blobStatements, externalizeRunRecord, externalizeSubmittedEvent } from "./blob.js";
import type { JsonObject } from "@anvia/core/completion";
import { escapeKey, readStored, RESERVED_KEYS, writeStored } from "./references.js";

/**
 * One-time rewrite of journal rows written before schema version 11 (see references.ts).
 *
 * Before version 11, any object shaped like a blob marker was read as one. The rewrite keeps a
 * reserved key as a marker only when it is a well-formed marker whose blob exists with the same
 * byte count: a real reference always has its blob, because both are written in one transaction.
 * Every other reserved or `~`-prefixed key is escaped, so user data reads back unchanged.
 *
 * Known limit: a user object that copies the marker of an existing blob (same hash and size) is
 * indistinguishable from a real reference and stays one. Rows written from version 11 on do not
 * have this limit.
 *
 * Message histories are content addressed, so rewriting a message changes its hash. The chain is
 * rebuilt from the first message, and every `head` in operations and events that use the linked
 * history encoding is renamed to the new hash.
 */
export function migrateLegacyRows(database: DatabaseSync): void {
  const blobBytes = database.prepare("SELECT bytes FROM anvia_durable_blobs WHERE hash = ?");
  const blobExists = (hash: string, bytes: number): boolean => {
    const row = blobBytes.get(hash);
    return row !== undefined && Number(row.bytes) === bytes;
  };

  const isHash = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const isCount = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  /** A reserved key may stay a marker only if its marker is well formed and its blob exists. */
  const keepsMarker = (key: string, value: unknown): boolean => {
    if (key === "anvia:blob")
      return (
        isObject(value) &&
        value.v === 1 &&
        isHash(value.hash) &&
        isCount(value.bytes) &&
        blobExists(value.hash, value.bytes as number)
      );
    return (
      Array.isArray(value) &&
      value.every(
        (entry) =>
          isObject(entry) &&
          typeof entry.path === "string" &&
          isHash(entry.hash) &&
          isCount(entry.bytes) &&
          blobExists(entry.hash, entry.bytes as number),
      )
    );
  };

  const encode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(encode);
    if (!isObject(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (RESERVED_KEYS.has(key) && keepsMarker(key, entry)) output[key] = entry;
      else output[escapeKey(key)] = encode(entry);
    }
    return output;
  };

  const digest = (text: string) => createHash("sha256").update(text).digest("hex");

  // Message content and history chain. Built first, rewritten last, so no row is half-migrated.
  const messages = new Map<string, { hash: string; text: string }>();
  for (const row of database.prepare("SELECT hash, record FROM anvia_durable_messages").all()) {
    const text = JSON.stringify(encode(JSON.parse(String(row.record))));
    messages.set(String(row.hash), { hash: digest(text), text });
  }
  const links = new Map<string, { previous: string | null; message: string }>();
  for (const row of database
    .prepare("SELECT hash, previous, message FROM anvia_durable_histories")
    .all()) {
    links.set(String(row.hash), {
      previous: row.previous === null ? null : String(row.previous),
      message: String(row.message),
    });
  }
  const heads = new Map<string, string>();
  for (const start of links.keys()) {
    const pending: string[] = [];
    let cursor: string | null = start;
    while (cursor !== null && !heads.has(cursor)) {
      const link = links.get(cursor);
      if (link === undefined) throw new Error("Corrupt operation history content.");
      pending.push(cursor);
      cursor = link.previous;
    }
    let base: string | null = cursor === null ? null : heads.get(cursor)!;
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index]!;
      const message = messages.get(links.get(node)!.message);
      if (message === undefined) throw new Error("Missing operation history content.");
      base = digest(JSON.stringify([base, message.hash]));
      heads.set(node, base);
    }
  }

  const renameHeads = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(renameHeads);
    if (!isObject(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] =
        key === "head" && typeof entry === "string" && heads.has(entry)
          ? heads.get(entry)
          : renameHeads(entry);
    }
    return output;
  };

  /** Rewrites one JSON column of every row, touching only rows whose text changes. */
  const rewrite = (
    select: string,
    update: string,
    column: "record" | "data",
    keys: readonly string[],
    transform: (row: Record<string, unknown>) => string,
  ) => {
    const statement = database.prepare(update);
    for (const row of database.prepare(select).all()) {
      const text = transform(row);
      if (text !== String(row[column])) {
        statement.run(text, ...keys.map((key) => row[key] as string | number));
      }
    }
  };

  rewrite(
    "SELECT id, record FROM anvia_durable_runs",
    "UPDATE anvia_durable_runs SET record = ? WHERE id = ?",
    "record",
    ["id"],
    (row) => JSON.stringify(encode(JSON.parse(String(row.record)))),
  );
  rewrite(
    "SELECT id, record FROM anvia_durable_graphs",
    "UPDATE anvia_durable_graphs SET record = ? WHERE id = ?",
    "record",
    ["id"],
    (row) => JSON.stringify(encode(JSON.parse(String(row.record)))),
  );
  rewrite(
    "SELECT id, record FROM anvia_durable_tasks",
    "UPDATE anvia_durable_tasks SET record = ? WHERE id = ?",
    "record",
    ["id"],
    (row) => JSON.stringify(encode(JSON.parse(String(row.record)))),
  );
  rewrite(
    "SELECT run_id, key, record FROM anvia_durable_operations",
    "UPDATE anvia_durable_operations SET record = ? WHERE run_id = ? AND key = ?",
    "record",
    ["run_id", "key"],
    (row) => {
      const parsed = JSON.parse(String(row.record)) as Record<string, unknown>;
      const linked = parsed.historyEncoding === "linked-v1";
      return JSON.stringify(encode(linked ? renameHeads(parsed) : parsed));
    },
  );
  rewrite(
    "SELECT sequence, data, history_encoding FROM anvia_durable_events",
    "UPDATE anvia_durable_events SET data = ? WHERE sequence = ?",
    "data",
    ["sequence"],
    (row) => {
      const parsed = JSON.parse(String(row.data));
      const linked = row.history_encoding === "linked-v1";
      return JSON.stringify(encode(linked ? renameHeads(parsed) : parsed));
    },
  );

  database.exec("DELETE FROM anvia_durable_histories; DELETE FROM anvia_durable_messages;");
  const putMessage = database.prepare(
    "INSERT OR IGNORE INTO anvia_durable_messages(hash, record) VALUES (?, ?)",
  );
  for (const message of messages.values()) putMessage.run(message.hash, message.text);
  const putLink = database.prepare(
    "INSERT OR IGNORE INTO anvia_durable_histories(hash, previous, message) VALUES (?, ?, ?)",
  );
  for (const [hash, link] of links) {
    const message = messages.get(link.message)!;
    putLink.run(
      heads.get(hash)!,
      link.previous === null ? null : heads.get(link.previous)!,
      message.hash,
    );
  }
}

/**
 * One-time move of oversized prompts out of version 11 rows (see blob.ts). Run records get their
 * prompt and input messages externalized; `submitted` events get their prompt externalized. Rows
 * that do not change are not rewritten, and every blob is written before the rows that name it.
 */
export function migrateOversizedPrompts(database: DatabaseSync): void {
  const io = blobStatements(database);
  const runs = database.prepare("SELECT id, record FROM anvia_durable_runs").all();
  const updateRun = database.prepare("UPDATE anvia_durable_runs SET record = ? WHERE id = ?");
  for (const row of runs) {
    const text = String(row.record);
    const next = writeStored(externalizeRunRecord(io, readStored(text) as JsonObject));
    if (next !== text) updateRun.run(next, String(row.id));
  }
  const events = database
    .prepare("SELECT sequence, data FROM anvia_durable_events WHERE type = 'submitted'")
    .all();
  const updateEvent = database.prepare(
    "UPDATE anvia_durable_events SET data = ? WHERE sequence = ?",
  );
  for (const row of events) {
    const text = String(row.data);
    const value = readStored(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const next = writeStored(externalizeSubmittedEvent(io, value as JsonObject));
    if (next !== text) updateEvent.run(next, Number(row.sequence));
  }
}
