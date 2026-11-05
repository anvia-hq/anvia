import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import { canonicalJson, json } from "./json.js";

/**
 * Large payload leaves (tool results, media, long texts) are stored in the blob table and replaced
 * by bounded references inside journal records, so one oversized artifact no longer fails a run or
 * inflates every record that carries it. A reference is content-addressed, so re-externalizing the
 * same content reproduces the same stored form and replay comparisons stay deterministic. Blob
 * writes share the referencing write's transaction: a committed reference is never dangling.
 *
 * Three reference shapes, all under the reserved `anvia` marker namespace:
 *
 * - `{ "anvia:blob": { v: 1, hash, bytes } }` replaces a whole value (a model result, the context
 *   document set, a tool output nested in a `{ type: "json", value: ... }` wrapper).
 * - `{ "anvia:blobs": [{ path, hash, bytes }] }` on an object restores individual leaves by path
 *   (used on outcome envelopes and on request documents).
 * - `metadata.anvia.durableBlobs` on a message restores individual content-part leaves by path.
 *
 * Anything below the threshold is stored inline, exactly as before.
 */

/** Serialized size above which a single leaf moves to the blob table. Fixed, so the stored form
 * never depends on the configured payload limits (which may change between restarts). */
export const BLOB_THRESHOLD_BYTES = 65_536;

const WHOLE_VALUE_MARKER = "anvia:blob";
const PATH_MARKER = "anvia:blobs";
const MESSAGE_MARKER = "durableBlobs";
const PLACEHOLDER_TEXT = "";

/** Minimal blob channel; `DurableTransaction` and the SQLite event reader both satisfy it. */
export type DurableBlobIO = {
  /** Stores an immutable JSON value and returns its content hash. */
  putBlob(value: JsonValue): string;
  /** Reads a blob back; a missing or corrupt blob is a storage failure. */
  getBlob(hash: string): JsonValue;
};

type BlobMarker = { v: 1; hash: string; bytes: number };
type PathMarker = { path: string; hash: string; bytes: number };

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

/** Prepared blob statements for one database. Mirrors the message-log pattern. */
export function blobStatements(database: DatabaseSync): DurableBlobIO {
  const put = database.prepare(
    "INSERT OR IGNORE INTO anvia_durable_blobs(hash, bytes, record) VALUES (?, ?, ?)",
  );
  const get = database.prepare("SELECT bytes, record FROM anvia_durable_blobs WHERE hash = ?");
  return {
    putBlob(value) {
      const record = canonicalJson(value);
      const hash = createHash("sha256").update(record).digest("hex");
      put.run(hash, byteLength(record), record);
      return hash;
    },
    getBlob(hash) {
      const row = get.get(hash);
      if (row === undefined) throw new Error("Missing durable blob content.");
      const record = String(row.record);
      if (byteLength(record) !== Number(row.bytes)) throw new Error("Corrupt durable blob record.");
      if (createHash("sha256").update(record).digest("hex") !== hash)
        throw new Error("Corrupt durable blob content.");
      return JSON.parse(record) as JsonValue;
    },
  };
}

function marker(value: JsonValue): BlobMarker {
  const record = canonicalJson(value);
  return {
    v: 1,
    hash: createHash("sha256").update(record).digest("hex"),
    bytes: byteLength(record),
  };
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function readMarker(value: unknown): BlobMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1 || !isHash(candidate.hash)) return undefined;
  if (!Number.isSafeInteger(candidate.bytes) || (candidate.bytes as number) < 0) return undefined;
  return candidate as unknown as BlobMarker;
}

function isWholeValueReference(value: unknown): BlobMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return readMarker((value as Record<string, unknown>)[WHOLE_VALUE_MARKER]);
}

function readPathMarkers(value: unknown): PathMarker[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const markers: PathMarker[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== "string" || !isHash(candidate.hash)) return undefined;
    if (!Number.isSafeInteger(candidate.bytes)) return undefined;
    markers.push(entry as unknown as PathMarker);
  }
  return markers;
}

/** A whole `{ "anvia:blob" }` carrier, valid anywhere a JSON value is allowed. */
function wholeValueReference(io: DurableBlobIO, value: JsonValue): JsonObject {
  return { [WHOLE_VALUE_MARKER]: { ...ioMarker(io, value) } };
}

function ioMarker(io: DurableBlobIO, value: JsonValue): BlobMarker {
  const mark = marker(value);
  io.putBlob(value);
  return mark;
}

function sizeOf(value: JsonValue): number {
  return byteLength(JSON.stringify(value));
}

function setPath(value: JsonValue, path: string, leaf: JsonValue): JsonValue {
  const segments = path.split(".");
  const rebuild = (node: JsonValue, depth: number): JsonValue => {
    const segment = segments[depth]!;
    if (depth === segments.length - 1) {
      if (Array.isArray(node)) {
        const copy = [...node];
        copy[Number(segment)] = leaf;
        return copy;
      }
      return { ...(node as JsonObject), [segment]: leaf };
    }
    if (Array.isArray(node)) {
      const copy = [...node];
      copy[Number(segment)] = rebuild(node[Number(segment)]!, depth + 1);
      return copy;
    }
    const object = node as JsonObject;
    return { ...object, [segment]: rebuild(object[segment]!, depth + 1) };
  };
  return rebuild(value, 0);
}

/**
 * Restores every reference shape. Applied to any value read out of the journal for execution or
 * inspection; the walk only rewrites values that carry a strict marker, so unmarked data passes
 * through unchanged (same content, new object identity).
 */
export function hydrateValue<T extends JsonValue>(io: Pick<DurableBlobIO, "getBlob">, value: T): T {
  if (Array.isArray(value)) return value.map((entry) => hydrateValue(io, entry)) as unknown as T;
  if (typeof value !== "object" || value === null) return value;
  let object = value as JsonObject;
  // A whole `{ "anvia:blob" }` carrier is replaced by the blob, whatever it sits inside.
  const whole = isWholeValueReference(object);
  if (whole !== undefined) return io.getBlob(whole.hash) as T;
  // A `{ type: "json", value: <carrier> }` tool output stands in for the whole output object.
  if (object.type === "json") {
    const wrapped = isWholeValueReference(object.value);
    if (wrapped !== undefined) return io.getBlob(wrapped.hash) as T;
  }
  if (isMessageShape(object)) {
    const anvia =
      typeof object.metadata === "object" && object.metadata !== null
        ? ((object.metadata as JsonObject).anvia as JsonObject | undefined)
        : undefined;
    const markers = readPathMarkers(anvia?.[MESSAGE_MARKER]);
    if (markers !== undefined) {
      let restored: JsonValue = object;
      for (const mark of markers) restored = setPath(restored, mark.path, io.getBlob(mark.hash));
      object = clearMessageMarker(restored as JsonObject) as JsonObject;
    }
  }
  const pathMarkers = readPathMarkers(object[PATH_MARKER]);
  if (pathMarkers !== undefined) {
    let restored: JsonValue = object;
    for (const mark of pathMarkers) restored = setPath(restored, mark.path, io.getBlob(mark.hash));
    const { [PATH_MARKER]: _dropped, ...rest } = restored as JsonObject;
    object = rest;
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [key, hydrateValue(io, entry)]),
  ) as T;
}

function isMessageShape(value: JsonObject): boolean {
  return (
    typeof value.role === "string" &&
    (typeof value.content === "string" || Array.isArray(value.content))
  );
}

function clearMessageMarker(message: JsonObject): JsonValue {
  const metadata = { ...(message.metadata as JsonObject) };
  const anvia = { ...(metadata.anvia as JsonObject | undefined) };
  delete anvia[MESSAGE_MARKER];
  if (Object.keys(anvia).length === 0) delete metadata.anvia;
  else metadata.anvia = anvia;
  const result: JsonObject = { ...message };
  if (Object.keys(metadata).length === 0) delete result.metadata;
  else result.metadata = metadata;
  return result;
}

/** The reference is always stored; the caller decides when the leaf is large enough. */
function externalizeLeaf(io: DurableBlobIO, value: JsonValue): PathMarker {
  const mark = marker(value);
  io.putBlob(value);
  return { path: "", hash: mark.hash, bytes: mark.bytes };
}

/**
 * Replaces oversized content leaves of one message with blob references recorded under
 * `metadata.anvia.durableBlobs`. A message whose metadata already uses the `anvia` key for a
 * non-object value is left inline; the field payload limit then applies as before.
 */
export function externalizeMessage(io: DurableBlobIO, message: Message): Message {
  if (sizeOf(message as JsonValue) <= BLOB_THRESHOLD_BYTES) return message;
  const markers: PathMarker[] = [];
  let content = message.content as JsonValue;
  const leaf = (path: string, value: JsonValue): PathMarker | undefined => {
    if (sizeOf(value) <= BLOB_THRESHOLD_BYTES) return undefined;
    const mark = externalizeLeaf(io, value);
    return { ...mark, path };
  };
  if (typeof content === "string") {
    const mark = leaf("content", content);
    if (mark !== undefined) {
      markers.push(mark);
      content = PLACEHOLDER_TEXT;
    }
  } else if (Array.isArray(content)) {
    content = content.map((part, index) => {
      if (typeof part !== "object" || part === null || Array.isArray(part)) return part;
      const record = { ...(part as JsonObject) };
      const type = record.type;
      const paths: [string, JsonValue][] = [];
      if (type === "text" || type === "reasoning") {
        if (typeof record.text === "string") paths.push([`content.${index}.text`, record.text]);
        if (Array.isArray(record.details))
          record.details = record.details.map((detail, detailIndex) => {
            if (typeof detail !== "object" || detail === null) return detail;
            const entry = { ...(detail as JsonObject) };
            for (const key of ["text", "data"] as const) {
              const value = entry[key];
              if (typeof value !== "string") continue;
              const path = `content.${index}.details.${detailIndex}.${key}`;
              const mark = leaf(path, value);
              if (mark !== undefined) {
                markers.push(mark);
                entry[key] = PLACEHOLDER_TEXT;
              }
            }
            return entry;
          });
      } else if (type === "image") {
        const image = record.image;
        if (
          typeof image === "object" &&
          image !== null &&
          !Array.isArray(image) &&
          (image as JsonObject).type === "data" &&
          typeof (image as JsonObject).data === "string"
        ) {
          const path = `content.${index}.image.data`;
          const mark = leaf(path, (image as JsonObject).data!);
          if (mark !== undefined) {
            markers.push(mark);
            record.image = { ...(image as JsonObject), data: PLACEHOLDER_TEXT };
          }
        }
      } else if (type === "file") {
        const data = record.data;
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          const entry = data as JsonObject;
          const key = entry.type === "data" ? "data" : entry.type === "text" ? "text" : undefined;
          const value = key === undefined ? undefined : entry[key];
          if (key !== undefined && typeof value === "string") {
            const path = `content.${index}.data.${key}`;
            const mark = leaf(path, value);
            if (mark !== undefined) {
              markers.push(mark);
              record.data = { ...entry, [key]: PLACEHOLDER_TEXT };
            }
          }
        }
      } else if (type === "tool-call") {
        if (record.input !== undefined) paths.push([`content.${index}.input`, record.input]);
      } else if (type === "tool-result") {
        if (record.output !== undefined) paths.push([`content.${index}.output`, record.output]);
      }
      for (const [path, value] of paths) {
        const mark = leaf(path, value);
        if (mark === undefined) continue;
        markers.push(mark);
        const key = path.slice(path.lastIndexOf(".") + 1);
        record[key] =
          key === "output"
            ? { type: "json", value: null }
            : key === "input"
              ? null
              : PLACEHOLDER_TEXT;
      }
      return record;
    });
  }
  if (markers.length === 0) return message;
  const metadata = { ...(message.metadata as JsonObject | undefined) };
  const anvia = metadata.anvia;
  if (anvia !== undefined && (typeof anvia !== "object" || anvia === null || Array.isArray(anvia)))
    return message; // The marker namespace is taken; the payload limit applies as before.
  metadata.anvia = {
    ...(anvia as JsonObject | undefined),
    [MESSAGE_MARKER]: markers,
  };
  return { ...message, content, metadata } as Message;
}

export function externalizeMessages(io: DurableBlobIO, messages: readonly Message[]): Message[] {
  return messages.map((message) => externalizeMessage(io, message));
}

export function hydrateMessages(
  io: Pick<DurableBlobIO, "getBlob">,
  messages: readonly Message[],
): Message[] {
  return messages.map((message) => hydrateValue(io, message as JsonValue) as Message);
}

/** A completed tool result (`{ output, failed, error? }`): the output object is blobbed whole. */
export function externalizeToolResult(io: DurableBlobIO, result: JsonValue): JsonValue {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  const record = result as JsonObject;
  const output = record.output;
  if (output === undefined || sizeOf(output) <= BLOB_THRESHOLD_BYTES) return result;
  return {
    ...record,
    output: { type: "json", value: wholeValueReference(io, output) },
  };
}

/**
 * A completed model response. The strict parts of the envelope stay parseable (`choice`, `usage`,
 * `rawResponse`); the full response is restored from the blob on read.
 */
export function externalizeModelResult(io: DurableBlobIO, result: JsonValue): JsonValue {
  if (sizeOf(result) <= BLOB_THRESHOLD_BYTES) return result;
  const record = result as JsonObject;
  return {
    choice: [{ type: "text", text: PLACEHOLDER_TEXT }],
    usage: record.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rawResponse: null,
    [WHOLE_VALUE_MARKER]: { ...ioMarker(io, result) },
  };
}

/** A model operation input (`{ provider, modelId, request }`): history and documents are walked. */
export function externalizeModelInput(io: DurableBlobIO, input: JsonValue): JsonValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as JsonObject;
  const request = record.request;
  if (typeof request !== "object" || request === null || Array.isArray(request)) return input;
  const value = { ...(request as JsonObject) };
  if (Array.isArray(value.chatHistory))
    value.chatHistory = externalizeMessages(io, value.chatHistory as Message[]);
  if (Array.isArray(value.documents))
    value.documents = value.documents.map((document) =>
      externalizeDocument(io, document as JsonObject),
    );
  return { ...record, request: value };
}

/** A request document: only the `text` leaf is bounded; a path reference sits beside it. */
function externalizeDocument(io: DurableBlobIO, document: JsonObject): JsonValue {
  const text = document.text;
  if (typeof text !== "string" || sizeOf(text) <= BLOB_THRESHOLD_BYTES) return document;
  const mark = externalizeLeaf(io, text);
  return {
    ...document,
    text: PLACEHOLDER_TEXT,
    [PATH_MARKER]: [{ ...mark, path: "text" }],
  };
}

/** A completed loop-context result (`{ messages, checkpoint?, compaction? }`; strict schema). */
export function externalizeContextResult(io: DurableBlobIO, result: JsonValue): JsonValue {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  const record = result as JsonObject;
  if (!Array.isArray(record.messages)) return result;
  return { ...record, messages: externalizeMessages(io, record.messages as Message[]) };
}

/**
 * The frozen `{ hash, documents }` context snapshot. The hash stays inline so replay verification
 * never needs the blob; a large document set moves behind a whole-value reference.
 */
export function externalizeContextDocuments(
  io: DurableBlobIO,
  value: { hash: string; documents: JsonValue },
): JsonValue {
  const full = json(value);
  if (sizeOf(full) <= BLOB_THRESHOLD_BYTES) return full;
  return { hash: value.hash, [WHOLE_VALUE_MARKER]: { ...ioMarker(io, full) } };
}

/**
 * The output of a stored run outcome, restored. The reference for an oversized output sits on the
 * outcome envelope (`anvia:blobs`), not on `output`, which is stored as `null`; so the envelope is
 * hydrated first and only then is `output` read. Reading `outcome.output` directly yields `null`.
 */
export function hydratedOutcomeOutput(
  io: Pick<DurableBlobIO, "getBlob">,
  outcome: JsonValue,
): JsonValue | undefined {
  const hydrated = hydrateValue(io, outcome) as JsonObject;
  return hydrated.output;
}

/** A run outcome: messages walk, oversized `text` moves out, continuation state is walked. */
export function externalizeOutcome<T extends JsonValue>(io: DurableBlobIO, outcome: T): T {
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return outcome;
  const record = { ...(outcome as JsonObject) };
  const markers: PathMarker[] = [];
  if (Array.isArray(record.messages))
    record.messages = externalizeMessages(io, record.messages as Message[]);
  if (typeof record.text === "string" && sizeOf(record.text) > BLOB_THRESHOLD_BYTES) {
    const mark = externalizeLeaf(io, record.text);
    markers.push({ ...mark, path: "text" });
    record.text = PLACEHOLDER_TEXT;
  }
  if (record.output !== undefined && sizeOf(record.output) > BLOB_THRESHOLD_BYTES) {
    const mark = externalizeLeaf(io, record.output);
    markers.push({ ...mark, path: "output" });
    record.output = null;
  }
  const continuation = record.continuation;
  if (typeof continuation === "object" && continuation !== null && !Array.isArray(continuation)) {
    const state = (continuation as JsonObject).state;
    if (typeof state === "object" && state !== null && !Array.isArray(state))
      record.continuation = {
        ...(continuation as JsonObject),
        state: externalizeContinuationState(io, state as JsonObject),
      };
  }
  if (markers.length > 0) record[PATH_MARKER] = markers;
  return record as T;
}

/** Continuation state carries full transcripts under known keys; walk those message arrays. */
function externalizeContinuationState(io: DurableBlobIO, state: JsonObject): JsonValue {
  const result = { ...state };
  for (const key of ["history", "messages"] as const) {
    const value = result[key];
    if (Array.isArray(value)) result[key] = externalizeMessages(io, value as Message[]);
  }
  if (Array.isArray(result.steering))
    result.steering = result.steering.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
      const queued = { ...(entry as JsonObject) };
      if (Array.isArray(queued.messages))
        queued.messages = externalizeMessages(io, queued.messages as Message[]);
      return queued;
    });
  return result;
}
