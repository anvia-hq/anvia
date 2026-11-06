import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  MemoryAppendOptions,
  MemoryAppendResult,
  MemoryLoadOptions,
  MemoryStore,
  MemoryVersionedHistory,
} from "@anvia/core/memory";
import type { Message } from "@anvia/core/completion";

type State = { messages: Message[]; version: number; writes: Record<string, string> };

/**
 * A memory store backed by one JSON file, so two processes see the same history. It implements the
 * versioned, idempotent contract for a single scope; it is a fixture, not a persistence layer.
 */
export class FileMemoryStore implements MemoryStore {
  constructor(
    private readonly path: string,
    private readonly beforeCommit: () => Promise<void> = async () => {},
    private readonly afterCommit: () => Promise<void> = async () => {},
  ) {}

  private read(): State {
    return existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as State)
      : { messages: [], version: 0, writes: {} };
  }

  async load(_options: MemoryLoadOptions): Promise<Message[]> {
    return this.read().messages;
  }

  async loadVersioned(_options: MemoryLoadOptions): Promise<MemoryVersionedHistory> {
    const state = this.read();
    return { messages: state.messages, version: String(state.version) };
  }

  async append(options: MemoryAppendOptions): Promise<MemoryAppendResult> {
    const state = this.read();
    const fingerprint = JSON.stringify([options.runId, options.turn, options.messages]);
    const known =
      options.idempotencyKey === undefined ? undefined : state.writes[options.idempotencyKey];
    if (known !== undefined)
      return {
        status: known === fingerprint ? "duplicate" : "conflict",
        version: String(state.version),
      };
    if (options.expectedVersion !== undefined && options.expectedVersion !== String(state.version))
      return { status: "conflict", version: String(state.version) };
    await this.beforeCommit();
    state.messages.push(...options.messages);
    state.version += 1;
    if (options.idempotencyKey !== undefined) state.writes[options.idempotencyKey] = fingerprint;
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state));
    renameSync(`${this.path}.tmp`, this.path);
    await this.afterCommit();
    return { status: "committed", version: String(state.version) };
  }

  async clear(): Promise<void> {
    writeFileSync(this.path, JSON.stringify({ messages: [], version: 0, writes: {} }));
  }
}
