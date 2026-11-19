import type { AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import { DurableAgentHandle } from "./agent-handle.js";
import type { DurableGraphClient, DurableSubmitClient } from "./client.js";
import { createGraph, graphSnapshot } from "./graph-state.js";
import { graphListSchema, parseDurableGraphSubmission } from "./graph-schema.js";
import type {
  DurableGraphListOptions,
  DurableGraphPage,
  DurableGraphSnapshot,
  DurableGraphSubmission,
} from "./graph-types.js";
import { DurableTaskGraph } from "./task-graph.js";
import type { JsonValue } from "@anvia/core/completion";
import { json } from "./json.js";
import { parseTaskSubmission, type TaskSubmission } from "./task-protocol.js";
import { parseTraceOptions } from "./trace-schema.js";
import { DurableTaskHandle } from "./tasks/handle.js";
import { taskListSchema } from "./tasks/schema.js";
import { TaskScheduler } from "./tasks/scheduler.js";
import type { DefinedTask, TaskListOptions } from "./tasks/types.js";
import { createUnadmittedRunRecord } from "./run-record.js";
import { listOptionsSchema } from "./schema.js";
import { readEvents, readRun, readRunScope, readSnapshot, readStatus } from "./reads.js";
import { DurableRun } from "./run.js";
import {
  cancelGraphRuns,
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
  DurableRunScope,
  DurableRunSummary,
  DurableSnapshot,
  DurableStore,
  DurableSteerOptions,
  DurableSubmission,
  DurableSubmitOptions,
  DurableTraceOptions,
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
export class DurableClient implements DurableSubmitClient, DurableGraphClient {
  private closed = false;

  /** Task controls and reads; it never claims or runs anything (`passive`). */
  private readonly tasks: TaskScheduler;

  private constructor(private readonly store: DurableStore) {
    this.tasks = new TaskScheduler(
      store,
      new Map(),
      1,
      () => {},
      new Map(),
      new Map(),
      new Map(),
      () => false,
      async () => {},
      { workerId: `client-${globalThis.crypto.randomUUID()}`, leaseMs: 30_000, passive: true },
    );
  }

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

  /** Owning scope for authorization without loading operation journals or graph results. */
  async runScope(runId: string): Promise<DurableRunScope> {
    this.assertOpen();
    return readRunScope(this.store, runId);
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

  /**
   * Records a static graph for workers to execute. Each task becomes an agent run in its own
   * session; the worker that claims it admits it against its registration. Like `submit()`, it
   * does not check that the agents exist.
   */
  async submitGraph(input: DurableGraphSubmission): Promise<DurableTaskGraph> {
    this.assertOpen();
    const submission = parseDurableGraphSubmission(input);
    const id = await this.store.transaction(async (tx) =>
      createGraph(tx, submission, new Map(), new Map(), new Map(), true),
    );
    return new DurableTaskGraph(id, this);
  }

  async getGraph(id: string): Promise<DurableTaskGraph> {
    await this.graphSnapshot(id);
    return new DurableTaskGraph(id, this);
  }

  async listGraphs(options: DurableGraphListOptions = {}): Promise<DurableGraphPage> {
    this.assertOpen();
    return this.store.listGraphs(graphListSchema.parse(options));
  }

  async graphSnapshot(id: string): Promise<DurableGraphSnapshot> {
    this.assertOpen();
    return this.store.transaction(async (tx) => graphSnapshot(tx, id), { readOnly: true });
  }

  async graphEvents(id: string, after: number) {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
    return this.store.graphEvents(id, after, 100);
  }

  /** Cancels every unfinished task. Workers stop their runs within one heartbeat. */
  async cancelGraph(id: string): Promise<void> {
    this.assertOpen();
    await cancelGraphRuns(this.store, id);
  }

  /**
   * Records a root task for workers to run. The client has no definition to parse the input or
   * build the checkpoint, so the worker that claims the task does; it fails the task if the input
   * is invalid, and leaves it waiting if no worker registers the name and version. The input must
   * be JSON, and a repeated key with equal input returns the same task.
   */
  async submitTask<I, S, R>(
    definition: DefinedTask<I, S, R>,
    input: {
      sessionId: string;
      requestId: string;
      input: I;
      trace?: DurableTraceOptions | undefined;
    },
  ): Promise<DurableTaskHandle<R>> {
    this.assertOpen();
    const id = await this.tasks.submitUnadmitted(
      {
        name: definition.name,
        version: definition.version,
        input: json(input.input),
        sessionId: input.sessionId,
        key: input.requestId,
      },
      parseTraceOptions(input.trace),
    );
    return this.taskHandle<R>(id);
  }

  /** Submits by name and version, as the HTTP routes do. */
  async submitRegisteredTask(input: TaskSubmission): Promise<DurableTaskHandle> {
    this.assertOpen();
    const submission = parseTaskSubmission(input);
    const id = await this.tasks.submitUnadmitted(
      {
        name: submission.name,
        version: submission.version,
        input: submission.input,
        sessionId: submission.sessionId,
        key: submission.requestId,
      },
      submission.trace,
    );
    return this.taskHandle(id);
  }

  async getTask(id: string): Promise<DurableTaskHandle> {
    this.assertOpen();
    await this.tasks.snapshot(id);
    return this.taskHandle(id);
  }

  async listTasks(options: TaskListOptions = {}) {
    this.assertOpen();
    return this.store.listTasks(taskListSchema.parse(options));
  }

  async taskGraph(id: string) {
    this.assertOpen();
    return this.tasks.graph(id);
  }

  private taskHandle<R = JsonValue>(id: string): DurableTaskHandle<R> {
    return new DurableTaskHandle<R>(id, this.tasks, this.store, () => this.assertOpen());
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
