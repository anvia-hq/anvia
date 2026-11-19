import type { AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import { DurableAgentHandle } from "./agent-handle.js";
import type { DurableSubmitClient } from "./client.js";
import { createUnadmittedRunRecord } from "./run-record.js";
import { listOptionsSchema } from "./schema.js";
import { readEvents, readRun, readSnapshot, readStatus } from "./reads.js";
import { DurableRun } from "./run.js";
import {
  cancelRun,
  parseSubmission,
  resolveMemoryWriteForRun,
  resolveToolForRun,
  respondToRun,
  retryRun,
  steerRun,
  submitRun,
} from "./mutations.js";
import type {
  DurableEvent,
  DurableListOptions,
  DurableRunPage,
  DurableRunRecord,
  DurableRunSummary,
  DurableSnapshot,
  DurableStore,
  DurableSteerOptions,
  DurableSubmission,
  DurableSubmitOptions,
  MemoryWriteResolution,
} from "./types.js";

export type DurableClientOptions = { store: DurableStore };

/**
 * Submits, controls and watches durable runs from a process that executes nothing: an API server,
 * a CLI or a dashboard. It holds no agent code and no lease. A run it submits is recorded and a
 * `DurableRuntime` worker (`worker: {}`) that registers the agent claims and executes it; the
 * worker admits the run against its own registration, so the client never needs the agent.
 * Several clients and workers share one database.
 *
 * A client cannot share a database with an owning runtime: `connect()` fails while one is live,
 * because an owner assumes it is the only writer (ADR 0001).
 */
export class DurableClient implements DurableSubmitClient {
  private closed = false;

  private constructor(private readonly store: DurableStore) {}

  static async connect(options: DurableClientOptions): Promise<DurableClient> {
    if (options.store.join === undefined)
      throw new TypeError(
        "This store does not support clients. Use a Postgres, Drizzle, or Prisma store.",
      );
    await options.store.join();
    return new DurableClient(options.store);
  }

  /**
   * A handle for submitting to one agent by id. `Output` types `result()`; the client cannot
   * check it, because it has no agent definition.
   */
  agent<Output = unknown>(agentId: string): DurableAgentHandle<Output> {
    this.assertOpen();
    return new DurableAgentHandle<Output>(agentId, this);
  }

  /**
   * Records a submission for a worker to execute. The agent is not checked here: a run for an
   * agent no worker registers waits until one does.
   */
  async submit(input: DurableSubmission, options: DurableSubmitOptions = {}): Promise<DurableRun> {
    this.assertOpen();
    const submission = parseSubmission(input, options);
    const id = await submitRun(this.store, submission, options, async () =>
      createUnadmittedRunRecord(submission),
    );
    return new DurableRun(id, this);
  }

  async getRun(id: string): Promise<DurableRun> {
    await this.run(id);
    return new DurableRun(id, this);
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

  async steer(
    id: string,
    input: AgentSteerInput,
    options: DurableSteerOptions = {},
  ): Promise<AgentSteerReceipt> {
    this.assertOpen();
    return steerRun(this.store, id, input, options);
  }

  async respond(id: string, interactionId: string, value: AgentInteractionResponse): Promise<void> {
    this.assertOpen();
    await respondToRun(this.store, id, interactionId, value);
  }

  async resolveTool(id: string, operationId: string, output: ToolResultOutput): Promise<void> {
    this.assertOpen();
    await resolveToolForRun(this.store, id, operationId, output);
  }

  async resolveMemoryWrite(
    id: string,
    operationKey: string,
    resolution: MemoryWriteResolution,
  ): Promise<void> {
    this.assertOpen();
    await resolveMemoryWriteForRun(this.store, id, operationKey, resolution);
  }

  /** The worker that claims the run rebuilds any missing history, as the client has no memory config. */
  async retry(id: string): Promise<void> {
    this.assertOpen();
    await retryRun(this.store, id, "defer");
  }

  /**
   * Settles the run as cancelled. A worker executing it notices on its next lease renewal (within
   * a heartbeat) and stops; its later writes cannot overwrite the cancelled outcome.
   */
  async cancel(id: string): Promise<void> {
    this.assertOpen();
    await cancelRun(this.store, id);
  }

  /** Closes the connection. Runs it submitted keep going on their workers. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.store.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Durable client is closed.");
  }
}
