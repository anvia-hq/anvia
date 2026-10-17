import type { Message } from "@anvia/core/completion";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { AcpError } from "./errors.js";
import type { AcpSessionConfig } from "./types.js";
import type { AcpTranscriptEntry } from "./transcript.js";

export type AcpSessionInfo = Readonly<{
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: string;
}>;

/** Private storage envelope. Never send this record or its messages to an editor. */
export type AcpSessionRecord = AcpSessionInfo &
  Readonly<{
    version: 1;
    createdAt: string;
    config: AcpSessionConfig;
    nextToolId: number;
    messages: readonly Message[];
    transcript: readonly AcpTranscriptEntry[];
  }>;

export type AcpSessionPage = {
  sessions: readonly AcpSessionInfo[];
  nextCursor?: string;
};

export type AcpSessionQuery = {
  cwd?: string;
  /** Canonical host roots, applied BEFORE pagination. Undefined permits all workspaces. */
  workspaceRoots?: readonly string[];
  cursor?: string;
  limit: number;
};

/**
 * Host-owned, trusted storage, scoped to one user and one active connection at a time.
 * get distinguishes missing records from empty history. put atomically replaces the ENTIRE
 * record (model history, transcript and metadata); rejection must leave the old record intact.
 * Return detached snapshots. Optional operations gate their corresponding wire capabilities.
 * Multi-process deployments must provide exclusive session ownership outside this contract.
 */
export interface AcpSessionStore {
  get(sessionId: string): Promise<AcpSessionRecord | undefined>;
  put(record: AcpSessionRecord): Promise<void>;
  list?(query: AcpSessionQuery): Promise<AcpSessionPage>;
  delete?(sessionId: string): Promise<void>;
}

export class InMemoryAcpSessionStore implements AcpSessionStore {
  private readonly records = new Map<string, AcpSessionRecord>();

  async get(sessionId: string): Promise<AcpSessionRecord | undefined> {
    return structuredClone(this.records.get(sessionId));
  }

  async put(record: AcpSessionRecord): Promise<void> {
    validateRecord(record);
    this.records.set(record.sessionId, structuredClone(record));
  }

  async delete(sessionId: string): Promise<void> {
    this.records.delete(sessionId);
  }

  async list(query: AcpSessionQuery): Promise<AcpSessionPage> {
    return page([...this.records.values()], query);
  }
}

/**
 * Opt-in JSON snapshot storage for a single local host. Atomic rename, 0600 files, 0700
 * newly created directories. Caller owns retention, encryption/backups and exclusive access.
 * Not an execution checkpoint: interrupted turns and pending approvals are never restored.
 */
export class FileAcpSessionStore implements AcpSessionStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    if (!isAbsolute(path)) throw new TypeError("Session store path must be absolute.");
  }

  get(sessionId: string): Promise<AcpSessionRecord | undefined> {
    return this.serial(async () =>
      (await this.read()).find((entry) => entry.sessionId === sessionId),
    );
  }

  put(record: AcpSessionRecord): Promise<void> {
    validateRecord(record);
    const snapshot = structuredClone(record);
    return this.serial(async () => {
      const records = (await this.read()).filter((entry) => entry.sessionId !== snapshot.sessionId);
      records.push(snapshot);
      await this.write(records);
    });
  }

  delete(sessionId: string): Promise<void> {
    return this.serial(async () => {
      await this.write((await this.read()).filter((entry) => entry.sessionId !== sessionId));
    });
  }

  list(query: AcpSessionQuery): Promise<AcpSessionPage> {
    return this.serial(async () => page(await this.read(), query));
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async read(): Promise<AcpSessionRecord[]> {
    let data: string;
    try {
      data = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: unknown = JSON.parse(data);
    if (!Array.isArray(records)) throw new AcpError("configuration_error");
    for (const record of records) validateRecord(record);
    if (new Set(records.map((record) => record.sessionId)).size !== records.length)
      throw new AcpError("configuration_error");
    return records;
  }

  private async write(records: AcpSessionRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export function validateRecord(value: unknown): asserts value is AcpSessionRecord {
  const record = value as AcpSessionRecord | undefined;
  if (
    !record ||
    record.version !== 1 ||
    typeof record.sessionId !== "string" ||
    !record.sessionId ||
    typeof record.cwd !== "string" ||
    !isAbsolute(record.cwd) ||
    typeof record.title !== "string" ||
    record.title.length > 200 ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    !record.config ||
    !["ask", "read-only"].includes(record.config.mode) ||
    (record.config.model !== undefined && typeof record.config.model !== "string") ||
    !Number.isSafeInteger(record.nextToolId) ||
    record.nextToolId < 0 ||
    !Array.isArray(record.messages) ||
    !Array.isArray(record.transcript) ||
    record.messages.some(
      (message) =>
        !message ||
        !["user", "assistant", "tool", "system"].includes(message.role) ||
        (typeof message.content !== "string" && !Array.isArray(message.content)),
    )
  )
    throw new AcpError("configuration_error");
}

export function sessionInfo(record: AcpSessionInfo): AcpSessionInfo {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

function page(records: readonly AcpSessionRecord[], query: AcpSessionQuery): AcpSessionPage {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
    throw new AcpError("configuration_error");
  let after = "";
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (
        cursor.cwd !== (query.cwd ?? null) ||
        JSON.stringify(cursor.roots) !== JSON.stringify(query.workspaceRoots ?? null) ||
        typeof cursor.after !== "string"
      )
        throw new Error();
      after = cursor.after;
    } catch {
      throw new AcpError("invalid_cursor");
    }
  }
  const filtered = records
    .filter(
      (record) =>
        (!query.cwd || record.cwd === query.cwd) &&
        (!query.workspaceRoots ||
          query.workspaceRoots.some((root) => contains(root, record.cwd))) &&
        record.sessionId > after,
    )
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const sessions = filtered.slice(0, query.limit).map(sessionInfo);
  const last = sessions.at(-1);
  const result: AcpSessionPage = { sessions };
  if (last && filtered.length > query.limit) {
    result.nextCursor = Buffer.from(
      JSON.stringify({
        cwd: query.cwd ?? null,
        roots: query.workspaceRoots ?? null,
        after: last.sessionId,
      }),
    ).toString("base64url");
  }
  return result;
}

export function contains(root: string, cwd: string): boolean {
  const path = relative(root, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
