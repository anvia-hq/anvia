import type { DurableRunReader } from "./client.js";
import { listOptionsSchema } from "./schema.js";
import { readEvents, readRun, readSnapshot, readStatus } from "./reads.js";
import { DurableRunView } from "./run.js";
import type {
  DurableEvent,
  DurableListOptions,
  DurableRunPage,
  DurableRunRecord,
  DurableRunSummary,
  DurableSnapshot,
  DurableStore,
} from "./types.js";

export type DurableObserverOptions = { store: DurableStore };

/**
 * Read-only access to durable runs from a process that does not own the database: a dashboard, an
 * API server streaming progress, or a CLI. It takes no lease and runs no migration, so it works
 * while a `DurableRuntime` elsewhere executes the runs, and it can never change a run. Mutations
 * (submit, cancel, respond, retry, steer) belong to the owning runtime, or to `DurableClient` when
 * workers share a Postgres-family database (ADR 0001).
 */
export class DurableObserver implements DurableRunReader {
  private closed = false;

  private constructor(private readonly store: DurableStore) {}

  static async connect(options: DurableObserverOptions): Promise<DurableObserver> {
    await options.store.connect();
    return new DurableObserver(options.store);
  }

  async getRun(id: string): Promise<DurableRunView> {
    await this.run(id);
    return new DurableRunView(id, this);
  }

  async listRuns(options: DurableListOptions = {}): Promise<DurableRunPage> {
    this.assertOpen();
    return this.store.list(listOptionsSchema.parse(options));
  }

  async run(id: string): Promise<DurableRunRecord> {
    this.assertOpen();
    return readRun(this.store, id);
  }

  async status(id: string): Promise<DurableRunSummary> {
    this.assertOpen();
    return readStatus(this.store, id);
  }

  async snapshot(id: string, options: { operations?: boolean } = {}): Promise<DurableSnapshot> {
    this.assertOpen();
    return readSnapshot(this.store, id, options);
  }

  async events(id: string, after: number): Promise<DurableEvent[]> {
    this.assertOpen();
    return readEvents(this.store, id, after);
  }

  /** Closes the store connection. It never touches the owner's run state or lease. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.store.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Durable observer is closed.");
  }
}
