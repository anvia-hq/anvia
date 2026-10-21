import type { Message } from "@anvia/core/completion";
import { messageSchema } from "@anvia/core/completion";
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
    /** Execution identity fences restores against a different driver/registration. */
    driverKey?: string;
    pendingRun?: import("./driver.js").AcpPendingRun | undefined;
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
 * Execution checkpoints/approvals live in a separate durable journal when that driver is used.
 */
export class FileAcpSessionStore implements AcpSessionStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    if (!isAbsolute(path)) throw new TypeError("Session store path must be absolute.");
  }

  get(sessionId: string): Promise<AcpSessionRecord | undefined> {
    return this.serial(async () => {
      const matches = (await this.read()).filter((entry) => storedSessionId(entry) === sessionId);
      if (matches.length > 1) throw new AcpError("configuration_error");
      if (matches.length === 0) return undefined;
      const record = matches[0];
      validateRecord(record);
      return record;
    });
  }

  put(record: AcpSessionRecord): Promise<void> {
    validateRecord(record);
    const snapshot = structuredClone(record);
    return this.serial(async () => {
      const records = (await this.read()).filter(
        (entry) => storedSessionId(entry) !== snapshot.sessionId,
      );
      records.push(snapshot);
      await this.write(records);
    });
  }

  delete(sessionId: string): Promise<void> {
    return this.serial(async () => {
      await this.write((await this.read()).filter((entry) => storedSessionId(entry) !== sessionId));
    });
  }

  list(query: AcpSessionQuery): Promise<AcpSessionPage> {
    return this.serial(async () => {
      const records = new Map<string, AcpSessionRecord | undefined>();
      for (const entry of await this.read()) {
        const id = storedSessionId(entry);
        if (id === undefined) continue;
        if (records.has(id)) {
          // Ambiguous IDs are unreadable too; do not expose either record.
          records.set(id, undefined);
          continue;
        }
        try {
          validateRecord(entry);
          records.set(id, entry);
        } catch {
          records.set(id, undefined);
        }
      }
      return page(
        [...records.values()].filter((record) => record !== undefined),
        query,
      );
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async read(): Promise<unknown[]> {
    try {
      const records: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!Array.isArray(records)) throw new AcpError("configuration_error");
      return records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AcpError("configuration_error");
    }
  }

  private async write(records: unknown[]): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } catch {
      throw new AcpError("configuration_error");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

function storedSessionId(value: unknown): string | undefined {
  if (value && typeof value === "object" && "sessionId" in value)
    return typeof value.sessionId === "string" ? value.sessionId : undefined;
  return undefined;
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
    (record.driverKey !== undefined &&
      (typeof record.driverKey !== "string" || !record.driverKey)) ||
    (record.pendingRun !== undefined &&
      (!record.pendingRun ||
        !record.driverKey ||
        typeof record.pendingRun.requestId !== "string" ||
        !record.pendingRun.requestId ||
        record.pendingRun.prompt?.role !== "user" ||
        !messageSchema.safeParse(record.pendingRun.prompt).success ||
        !Array.isArray(record.pendingRun.blocks) ||
        record.pendingRun.blocks.length === 0)) ||
    record.messages.some((message) => !messageSchema.safeParse(message).success)
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
  let after: Pick<AcpSessionInfo, "updatedAt" | "sessionId"> | undefined;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (
        cursor.cwd !== (query.cwd ?? null) ||
        JSON.stringify(cursor.roots) !== JSON.stringify(query.workspaceRoots ?? null) ||
        typeof cursor.after?.sessionId !== "string" ||
        !cursor.after.sessionId ||
        typeof cursor.after.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(cursor.after.updatedAt))
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
        (record.messages.length > 0 || record.transcript.length > 0 || !!record.pendingRun) &&
        (!query.cwd || record.cwd === query.cwd) &&
        (!query.workspaceRoots ||
          query.workspaceRoots.some((root) => contains(root, record.cwd))) &&
        (!after || compareSessions(record, after) > 0),
    )
    .sort(compareSessions);
  const sessions = filtered.slice(0, query.limit).map(sessionInfo);
  const last = sessions.at(-1);
  const result: AcpSessionPage = { sessions };
  if (last && filtered.length > query.limit) {
    result.nextCursor = Buffer.from(
      JSON.stringify({
        cwd: query.cwd ?? null,
        roots: query.workspaceRoots ?? null,
        after: { updatedAt: last.updatedAt, sessionId: last.sessionId },
      }),
    ).toString("base64url");
  }
  return result;
}

function compareSessions(
  a: Pick<AcpSessionInfo, "updatedAt" | "sessionId">,
  b: Pick<AcpSessionInfo, "updatedAt" | "sessionId">,
): number {
  return (
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
    (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
  );
}

export function contains(root: string, cwd: string): boolean {
  const path = relative(root, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
