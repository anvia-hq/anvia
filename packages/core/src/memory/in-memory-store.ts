import type { Message } from "../completion/types";
import { createMemoryScopeKey } from "./scope-key";
import type {
  MemoryAppendOptions,
  MemoryAppendResult,
  MemoryClearOptions,
  MemoryLoadOptions,
  MemoryStore,
  MemoryVersionedHistory,
} from "./types";

type ScopeState = {
  messages: Message[];
  version: number;
  /** Idempotency key to the fingerprint of the write that committed it. */
  writes: Map<string, string>;
};

/**
 * A process-local {@link MemoryStore} that implements the versioned and idempotent contract. It is
 * a reference for tests and prototypes, not a persistence layer: nothing survives the process.
 *
 * Versions are opaque strings that change on every committed append and on `clear`. Idempotency
 * keys are kept across `clear`, so a retried write cannot run twice in the same scope.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly scopes = new Map<string, ScopeState>();

  async load(options: MemoryLoadOptions): Promise<Message[]> {
    return [...this.state(options.scope).messages];
  }

  async loadVersioned(options: MemoryLoadOptions): Promise<MemoryVersionedHistory> {
    const state = this.state(options.scope);
    return { messages: [...state.messages], version: String(state.version) };
  }

  async append(options: MemoryAppendOptions): Promise<MemoryAppendResult> {
    const state = this.state(options.scope);
    const fingerprint = JSON.stringify({
      runId: options.runId,
      turn: options.turn,
      messages: options.messages,
    });

    if (options.idempotencyKey !== undefined) {
      const committed = state.writes.get(options.idempotencyKey);
      if (committed !== undefined) {
        const status = committed === fingerprint ? "duplicate" : "conflict";
        return { status, version: String(state.version) };
      }
    }

    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== String(state.version)
    ) {
      return { status: "conflict", version: String(state.version) };
    }

    state.messages.push(...options.messages);
    state.version += 1;
    if (options.idempotencyKey !== undefined) {
      state.writes.set(options.idempotencyKey, fingerprint);
    }
    return { status: "committed", version: String(state.version) };
  }

  async clear(options: MemoryClearOptions): Promise<void> {
    const state = this.state(options.scope);
    state.messages = [];
    state.version += 1;
  }

  private state(scope: MemoryLoadOptions["scope"]): ScopeState {
    const key = createMemoryScopeKey({ scope, includeUserId: true });
    let state = this.scopes.get(key);
    if (state === undefined) {
      state = { messages: [], version: 0, writes: new Map() };
      this.scopes.set(key, state);
    }
    return state;
  }
}
