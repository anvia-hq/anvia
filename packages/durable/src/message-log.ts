import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JsonObject, JsonValue } from "@anvia/core/completion";
import type { DurableOperation } from "./types.js";

export const messageLogTables = `
  CREATE TABLE IF NOT EXISTS anvia_durable_messages (
    hash TEXT PRIMARY KEY, record TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS anvia_durable_histories (
    hash TEXT PRIMARY KEY, previous TEXT, message TEXT NOT NULL
  );
`;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Immutable message content and persistent list prefixes, shared across runs and epochs.
 * Writes share the operation's transaction: a committed reference can never be dangling.
 * JSON text (including object key order) is retained exactly, without semantic normalization.
 */
export function messageLog(database: DatabaseSync) {
  const putMessage = database.prepare(
    "INSERT OR IGNORE INTO anvia_durable_messages(hash, record) VALUES (?, ?)",
  );
  const putHistory = database.prepare(
    "INSERT OR IGNORE INTO anvia_durable_histories(hash, previous, message) VALUES (?, ?, ?)",
  );
  const getHistory = database.prepare(
    `SELECT h.previous, h.message, m.record FROM anvia_durable_histories h
     JOIN anvia_durable_messages m ON m.hash = h.message WHERE h.hash = ?`,
  );

  function pack(messages: JsonValue): JsonValue {
    if (!Array.isArray(messages)) throw new Error("Invalid operation history.");
    let head: string | null = null;
    for (const message of messages) {
      const record = JSON.stringify(message);
      const hash = digest(record);
      putMessage.run(hash, record);
      const next = digest(JSON.stringify([head, hash]));
      putHistory.run(next, head, hash);
      head = next;
    }
    return { head, length: messages.length };
  }

  function unpack(value: JsonValue): JsonValue[] {
    const ref = value as JsonObject;
    if (
      ref === null ||
      typeof ref !== "object" ||
      Array.isArray(ref) ||
      !Number.isSafeInteger(ref.length) ||
      Number(ref.length) < 0 ||
      (ref.head !== null && typeof ref.head !== "string")
    )
      throw new Error("Invalid operation history reference.");
    const messages: JsonValue[] = [];
    let head = ref.head;
    for (let index = 0; index < Number(ref.length); index++) {
      if (typeof head !== "string") throw new Error("Truncated operation history.");
      const row = getHistory.get(head);
      if (row === undefined) throw new Error("Missing operation history content.");
      if (
        digest(String(row.record)) !== row.message ||
        digest(JSON.stringify([row.previous, row.message])) !== head
      )
        throw new Error("Corrupt operation history content.");
      messages.push(JSON.parse(String(row.record)) as JsonValue);
      head = row.previous as string | null;
    }
    if (head !== null) throw new Error("Invalid operation history length.");
    return messages.reverse();
  }

  function map(operation: DurableOperation, transform: (value: JsonValue) => JsonValue) {
    if (operation.kind === "model") {
      return { ...operation, input: requestInput(operation.input, transform) };
    }
    const result = operation.result as JsonObject | undefined;
    return {
      ...operation,
      input: transform(operation.input),
      ...(result === undefined
        ? {}
        : {
            result: { ...result, messages: transform(result.messages!) },
          }),
    };
  }

  function requestInput(value: JsonValue, transform: (value: JsonValue) => JsonValue): JsonValue {
    const input = value as JsonObject;
    const request = input.request as JsonObject;
    return { ...input, request: { ...request, chatHistory: transform(request.chatHistory!) } };
  }

  function event(data: JsonValue, transform: (value: JsonValue) => JsonValue): JsonValue {
    const value = data as JsonObject;
    return { ...value, input: requestInput(value.input!, transform) };
  }

  return {
    packEvent: (data: JsonValue) => event(data, pack),
    unpackEvent: (data: JsonValue) => event(data, unpack),
    pack(operation: DurableOperation): DurableOperation {
      if (
        operation.historyEncoding !== undefined ||
        (operation.kind !== "model" && operation.kind !== "context")
      )
        return operation;
      return { ...map(operation, pack), historyEncoding: "linked-v1" };
    },
    unpack(operation: DurableOperation): DurableOperation {
      if (operation.historyEncoding === undefined) return operation;
      const { historyEncoding: _, ...expanded } = map(operation, unpack);
      return expanded;
    },
  };
}
