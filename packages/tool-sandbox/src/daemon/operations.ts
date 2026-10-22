import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DockerSandboxError } from "../errors";

export interface OperationStoreOptions {
  /** Directory holding one small file per completed operation. */
  directory: string;
  /** Completed operations kept (on disk and in memory); the oldest are evicted first. */
  maxEntries?: number | undefined;
  /**
   * Largest serialized result written to disk. A bigger result is replaced by a marker, so a
   * retry fails instead of running the operation twice. Defaults to 256 KiB.
   */
  maxStoredResultBytes?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

type StoredOperation = {
  operationId: string;
  fingerprint: string;
  result?: unknown;
  /** Set when the result was too large to keep. The operation ran, but its answer is gone. */
  resultDropped?: true;
};

export interface OperationRunOptions {
  /**
   * Keep the result on disk so it outlives the daemon. Pass false for results that describe
   * in-memory daemon state (such as processes): after a restart that state is gone, so replaying
   * the stored result would describe something that no longer exists. Defaults to true.
   */
  durable?: boolean;
}

export const defaultMaxOperationEntries = 256;
export const defaultMaxStoredResultBytes = 256 * 1024;

/**
 * Makes mutating requests execute once per `operationId`. A retry that arrives while the first
 * attempt is running joins it; a retry that arrives later gets the stored result. Only successful
 * results are kept, so a failed or cancelled attempt can be retried for real.
 *
 * The table is bounded in entries and in bytes per entry. An operation evicted from it executes
 * again if retried, so the guarantee covers the most recent `maxEntries` operations, not all of
 * history. Results are stored verbatim, command output included, so the directory should be
 * private to the daemon.
 */
export class OperationStore {
  private readonly directory: string;
  private readonly maxEntries: number;
  private readonly maxStoredResultBytes: number;
  private readonly volatile = new Map<string, StoredOperation>();
  private readonly inflight = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  private prepared: Promise<void> | undefined;
  private writesSincePrune = 0;

  constructor(private readonly options: OperationStoreOptions) {
    this.directory = options.directory;
    this.maxEntries = options.maxEntries ?? defaultMaxOperationEntries;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive safe integer.");
    }
    this.maxStoredResultBytes = options.maxStoredResultBytes ?? defaultMaxStoredResultBytes;
    if (!Number.isSafeInteger(this.maxStoredResultBytes) || this.maxStoredResultBytes < 1) {
      throw new RangeError("maxStoredResultBytes must be a positive safe integer.");
    }
  }

  async run<T>(
    operationId: string,
    request: { method: string; params: unknown },
    execute: () => Promise<T>,
    { durable = true }: OperationRunOptions = {},
  ): Promise<T> {
    const fingerprint = fingerprintRequest(request);

    while (true) {
      const running = this.inflight.get(operationId);
      if (running !== undefined) {
        assertSameRequest(operationId, running.fingerprint, fingerprint);
        try {
          return (await running.promise) as T;
        } catch (error) {
          // The first attempt was cancelled, so it never completed and this retry owns the
          // operation now. Any other failure is real and is reported as is.
          if (isAbortError(error)) continue;
          throw error;
        }
      }

      const stored = this.volatile.get(operationId) ?? (await this.load(operationId));
      if (stored !== undefined) {
        assertSameRequest(operationId, stored.fingerprint, fingerprint);
        if (stored.resultDropped) {
          throw new DockerSandboxError(
            `Operation ${operationId} already ran, but its result was too large to store.`,
            "invalid_state",
          );
        }
        return stored.result as T;
      }
      // Another retry may have started while the disk lookup was pending.
      if (this.inflight.has(operationId)) continue;

      const promise = execute().then(async (result) => {
        if (durable) await this.save({ operationId, fingerprint, result });
        else this.remember({ operationId, fingerprint, result });
        return result;
      });
      this.inflight.set(operationId, { fingerprint, promise });
      try {
        return await promise;
      } finally {
        this.inflight.delete(operationId);
      }
    }
  }

  private async load(operationId: string): Promise<StoredOperation | undefined> {
    try {
      const raw = await readFile(this.fileFor(operationId), "utf8");
      const parsed = JSON.parse(raw) as StoredOperation;
      return parsed.operationId === operationId ? parsed : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.options.onError?.(error);
      return undefined;
    }
  }

  private remember(entry: StoredOperation): void {
    this.volatile.delete(entry.operationId);
    this.volatile.set(entry.operationId, entry);
    for (const oldest of this.volatile.keys()) {
      if (this.volatile.size <= this.maxEntries) break;
      this.volatile.delete(oldest);
    }
  }

  private async save(entry: StoredOperation): Promise<void> {
    try {
      let serialized = JSON.stringify(entry);
      if (Buffer.byteLength(serialized) > this.maxStoredResultBytes) {
        const { operationId, fingerprint } = entry;
        serialized = JSON.stringify({ operationId, fingerprint, resultDropped: true });
      }
      await this.prepare();
      const target = this.fileFor(entry.operationId);
      const temporary = `${target}.tmp`;
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, target);
      this.writesSincePrune += 1;
      if (this.writesSincePrune >= Math.max(1, Math.floor(this.maxEntries / 8))) {
        this.writesSincePrune = 0;
        await this.prune();
      }
    } catch (error) {
      // The operation already ran. Losing its record weakens retry safety but must not turn a
      // successful operation into a reported failure.
      this.options.onError?.(error);
    }
  }

  private prepare(): Promise<void> {
    this.prepared ??= mkdir(this.directory, { recursive: true, mode: 0o700 }).then(() => undefined);
    return this.prepared;
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json"));
    if (names.length <= this.maxEntries) return;
    const dated = await Promise.all(
      names.map(async (name) => ({
        name,
        modified: (await stat(path.join(this.directory, name))).mtimeMs,
      })),
    );
    dated.sort((a, b) => a.modified - b.modified);
    for (const { name } of dated.slice(0, names.length - this.maxEntries)) {
      await rm(path.join(this.directory, name), { force: true });
    }
  }

  private fileFor(operationId: string): string {
    return path.join(
      this.directory,
      `${createHash("sha256").update(operationId).digest("hex")}.json`,
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function assertSameRequest(operationId: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new DockerSandboxError(
      `operationId was reused for a different request: ${operationId}`,
      "invalid_state",
    );
  }
}

function fingerprintRequest(request: { method: string; params: unknown }): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
