import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type { Message } from "@anvia/core/completion";
import type {
  MemoryAppendOptions,
  MemoryAppendResult,
  MemoryLoadOptions,
  MemoryStore,
  MemoryVersionedHistory,
} from "@anvia/core/memory";
import { externalizeMessages, hydrateValue } from "./blob.js";
import { DurableRecoveryError } from "./errors.js";
import { json } from "./json.js";
import type {
  DurableAgentRegistration,
  DurableOperation,
  DurableRunRecord,
  DurableStore,
  DurableTransaction,
  MemoryWriteResolution,
} from "./types.js";

/**
 * Recorded memory. A run reads its history once, before the first model call, and records that
 * snapshot; a replay reuses it. Core's appends are captured while the run executes and written to
 * the store only after the run's terminal checkpoint. Each write is a `memory` operation keyed by
 * `${epoch}:memory:write:${seq}` and carries an idempotency key derived from the run, so a write
 * the store already committed is a duplicate, never a second copy.
 */

const READ_SUFFIX = "read";
const WRITE_PREFIX = "write:";

function memoryPrefix(run: DurableRunRecord): string {
  return `${run.epoch}:memory`;
}

/** Derived by the runtime from the run and the write's step. Callers never supply it. */
export function memoryIdempotencyKey(runId: string, operationKey: string): string {
  return `${runId}/${operationKey}`;
}

/** The agent's memory when the registration admits it; undefined otherwise. */
export function recordedMemoryOf(registration: DurableAgentRegistration) {
  if (registration.memory === undefined) return undefined;
  return getResolvedAgentOptions(registration.agent).memory;
}

type ReadSnapshot = MemoryVersionedHistory;

/**
 * The per-run store core uses. Reads go through the recorded snapshot. Writes are only captured
 * here; they reach the source store in `flushRecordedMemory`, after the terminal checkpoint.
 */
export function recordedMemoryStore(options: {
  store: DurableStore;
  run: DurableRunRecord;
  source: MemoryStore;
  captured: MemoryAppendOptions[];
  signal: AbortSignal;
}): MemoryStore {
  const { captured } = options;
  return {
    async load(loadOptions: MemoryLoadOptions) {
      return (await readSnapshot(options, loadOptions)).messages;
    },
    async loadVersioned(loadOptions: MemoryLoadOptions) {
      return readSnapshot(options, loadOptions);
    },
    async append(write: MemoryAppendOptions): Promise<MemoryAppendResult | void> {
      // Durable owns the keys and the version chain; a caller-supplied value would bypass both.
      if (write.idempotencyKey !== undefined || write.expectedVersion !== undefined)
        throw new TypeError(
          "Durable memory derives idempotency keys and versions; memory writes must not set them.",
        );
      captured.push({
        scope: write.scope,
        runId: write.runId,
        turn: write.turn,
        messages: [...write.messages],
      });
    },
    async clear() {
      throw new TypeError("Durable memory cannot be cleared from inside a run.");
    },
  };
}

async function readSnapshot(
  options: { store: DurableStore; run: DurableRunRecord; source: MemoryStore; signal: AbortSignal },
  loadOptions: MemoryLoadOptions,
): Promise<ReadSnapshot> {
  const { store, run, source, signal } = options;
  const key = `${memoryPrefix(run)}:${READ_SUFFIX}`;
  const recorded = store.transaction((tx) => tx.getOperation(run.id, key));
  if (recorded?.status === "completed") {
    const value = recorded.result as unknown as { messages: Message[]; version: string };
    return store.transaction((tx) => ({
      messages: hydrateValue(tx, json(value.messages)) as unknown as Message[],
      version: value.version,
    }));
  }
  signal.throwIfAborted();
  if (source.loadVersioned === undefined)
    throw new TypeError("Recorded memory needs a store with loadVersioned().");
  const loaded = await source.loadVersioned({ scope: loadOptions.scope });
  store.transaction((tx) => {
    tx.putOperation(run.id, {
      key,
      kind: "memory",
      input: json({ scope: loadOptions.scope }),
      status: "completed",
      // A read has no effect, so an interrupted one is simply read again.
      recovery: "safe",
      result: json({ messages: externalizeMessages(tx, loaded.messages), version: loaded.version }),
    });
  });
  return loaded;
}

/**
 * Records the captured writes as `started` memory operations with no attempt yet. Called in the
 * terminal checkpoint transaction, so the writes survive a crash that follows it.
 */
export function recordMemoryWrites(
  tx: DurableTransaction,
  run: DurableRunRecord,
  writes: readonly MemoryAppendOptions[],
): void {
  writes.forEach((write, seq) => {
    tx.putOperation(run.id, {
      key: `${memoryPrefix(run)}:${WRITE_PREFIX}${seq}`,
      kind: "memory",
      input: json({
        scope: write.scope,
        runId: write.runId,
        turn: write.turn,
        messages: externalizeMessages(tx, write.messages),
      }),
      status: "started",
      recovery: "manual",
      attempts: 0,
    });
  });
}

/**
 * Writes every recorded memory write that has not committed yet, in order. A write whose attempt
 * was persisted but never resolved is uncertain: the run needs attention, and retry() allows the
 * write to be sent again under the same key. A conflict stops the run without writing.
 */
export async function flushRecordedMemory(options: {
  store: DurableStore;
  run: DurableRunRecord;
  source: MemoryStore;
  signal: AbortSignal;
}): Promise<void> {
  const { store, run, source, signal } = options;
  const prefix = memoryPrefix(run);
  const writePrefix = `${prefix}:${WRITE_PREFIX}`;
  // Each write is based on the version the previous step left behind.
  let version = store.transaction((tx) => {
    const read = tx.getOperation(run.id, `${prefix}:${READ_SUFFIX}`);
    return read?.status === "completed"
      ? (read.result as unknown as { version: string }).version
      : undefined;
  });
  const writes = store
    .transaction((tx) => tx.operations(run.id))
    .filter((operation) => operation.kind === "memory" && operation.key.startsWith(writePrefix))
    .sort((left, right) => sequence(left) - sequence(right));

  for (const write of writes) {
    if (write.status === "completed") {
      version = (write.result as unknown as { version: string | null }).version ?? undefined;
      continue;
    }
    if ((write.attempts ?? 0) > 0)
      throw new DurableRecoveryError(
        `Memory write ${write.key} was interrupted before its outcome was recorded. Retry the run to send it again; the idempotency key stops the store from writing it twice.`,
        write.key,
      );
    signal.throwIfAborted();
    const input = store.transaction((tx) => {
      // Persisted before the store call, so a crash inside the call leaves the attempt visible.
      tx.putOperation(run.id, { ...write, attempts: 1 });
      return hydrateValue(tx, write.input) as unknown as {
        scope: MemoryAppendOptions["scope"];
        runId: string;
        turn: number;
        messages: Message[];
      };
    });
    const result = await source.append({
      scope: input.scope,
      runId: input.runId,
      turn: input.turn,
      messages: input.messages,
      idempotencyKey: memoryIdempotencyKey(run.id, write.key),
      expectedVersion: version,
    });
    const status = result?.status ?? "committed";
    if (status === "conflict")
      throw new DurableRecoveryError(
        `Memory write ${write.key} conflicts with the memory store: the history changed after this run read it, or the key was committed with different content. Nothing was written.`,
        write.key,
      );
    const recorded = { status, version: result?.version ?? null };
    store.transaction((tx) => {
      tx.putOperation(run.id, {
        ...write,
        attempts: 1,
        status: "completed",
        result: json(recorded),
      } satisfies DurableOperation);
    });
    version = recorded.version ?? undefined;
  }
}

/**
 * Settles a blocked memory write. `applied` records that the operator confirmed the store already
 * holds the messages; `discarded` drops them. The write is marked completed without a version, so
 * the next write is sent without a version check: the operator has accepted the divergence.
 */
export function resolveRecordedMemoryWrite(
  tx: DurableTransaction,
  run: DurableRunRecord,
  operation: DurableOperation,
  resolution: MemoryWriteResolution,
): void {
  tx.putOperation(run.id, {
    ...operation,
    status: "completed",
    result: json({ status: resolution, version: null }),
  });
}

/** Retry resets an uncertain write so the next flush sends it again under the same key. */
export function isRecordedMemoryWrite(operation: DurableOperation): boolean {
  return operation.kind === "memory" && operation.key.includes(`:${WRITE_PREFIX}`);
}

function sequence(operation: DurableOperation): number {
  return Number(operation.key.slice(operation.key.lastIndexOf(":") + 1));
}
