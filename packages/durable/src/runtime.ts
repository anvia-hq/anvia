import {
  cancelGraphRuns,
  cancelRun,
  parseSubmission,
  requireRun,
  resolveMemoryWriteForRun,
  resolveToolForRun,
  respondToRun,
  retryRun,
  SETTLED_STATUSES,
  setStatus,
  steerRun,
  submitRun,
} from "./mutations.js";
import type { Agent, AgentOutcome, AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import { promptMessage } from "./prompt.js";
import { MaxTurnsError } from "@anvia/core/agent";
import type { DefinedGoal } from "./goals/definition.js";
import type { GoalInput, GoalResult } from "./goals/schema.js";
import { parseTaskSubmission, type TaskSubmission } from "./task-protocol.js";
import { durableLimits, type DurableLimits } from "./limits.js";
import { guardStore } from "./storage-guard.js";
import { taskListSchema } from "./tasks/schema.js";
import { DurableTaskGraph } from "./task-graph.js";
import { TaskScheduler } from "./tasks/scheduler.js";
import { DurableTaskHandle } from "./tasks/handle.js";
import type { DefinedTask, RegisteredTask, TaskListOptions } from "./tasks/types.js";
import { TASK_SESSION_PREFIX, agentTask } from "./tasks/agent.js";
import { parseDurableGraphSubmission, graphListSchema } from "./graph-schema.js";
import { createGraph, graphInput, graphSnapshot } from "./graph-state.js";
import { admitRunRecord, createRunRecord } from "./run-record.js";
import type {
  DurableGraphSubmission,
  DurableGraphSnapshot,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";
import { type AgentInteractionResponse } from "@anvia/core/agent/interactions";
import { type CompletionRequest, type ToolResultOutput } from "@anvia/core/completion";
import type { MemoryAppendOptions } from "@anvia/core/memory";
import { withInternalAgentRunOptions } from "@anvia/core/internal/agent";
import {
  DurableConflictError,
  DurableModelError,
  DurableClaimLostError,
  DurableNotFoundError,
  DurableRecoveryError,
  DurableStorageError,
  DurableLimitError,
} from "./errors.js";
import { prepareContext } from "./compaction.js";
import { settledHistory } from "./settled-progress.js";
import { externalizeMessages, externalizeOutcome, hydrateValue } from "./blob.js";
import { contextDocumentsOf } from "./documents.js";
import { mcpServersByAgent, mcpServersOf, type DurableMcpServers } from "./mcp-servers.js";
import { toolIndexesByAgent, toolIndexesOf, type DurableToolIndexes } from "./tool-indexes.js";
import { vectorContextOf } from "./vector-context.js";
import { createExecution } from "./execution.js";
import { createObservedLifecycle } from "./observed-lifecycle.js";
import { createRecordedHooks } from "./recorded-hooks.js";
import { createRecordedGuardrails } from "./recorded-guardrails.js";
import {
  assertMemoryFreeTask,
  flushRecordedMemory,
  recordMemoryWrites,
  recordedMemoryOf,
  recordedMemoryStore,
} from "./recorded-memory.js";
import { runTrace } from "./trace.js";
import { parseTraceOptions } from "./trace-schema.js";
import { errorMessage, json, nonblank } from "./json.js";
import { listOptionsSchema } from "./schema.js";
import { registrations } from "./registration.js";
import { compatibilityReport } from "./compatibility.js";
import { DurableAgentHandle } from "./agent-handle.js";
import { claimContext, fenceStore } from "./fencing.js";
import { AUTO_VERSION, AUTO_VERSION_PATTERN, resolveAutoVersions } from "./fingerprint.js";
import { readEvents, readRun, readRunScope, readSnapshot, readStatus } from "./reads.js";
import type { DurableSubmitClient } from "./client.js";
import { DurableRun } from "./run.js";
import type {
  DurableSteerOptions,
  DurableAgentCompatibility,
  DurableAgentRegistration,
  DurableClaim,
  DurableListOptions,
  DurableRunPage,
  DurableSubmitOptions,
  DurableRunRecord,
  MemoryWriteResolution,
  DurableRuntimeOptions,
  DurableSnapshot,
  DurableRunSummary,
  DurableStore,
  DurableSubmission,
  DurableTraceOptions,
  DurableTransaction,
  DurableRunScope,
} from "./types.js";

export class DurableRuntime implements DurableSubmitClient {
  private readonly agents: Map<string, DurableAgentRegistration>;
  private readonly active = new Map<
    string,
    {
      agentId: string;
      sessionId: string;
      controller: AbortController;
      task: Promise<void>;
      claim: DurableClaim | undefined;
    }
  >();
  private readonly worker: ResolvedWorker | undefined;
  private workerTimer: ReturnType<typeof setInterval> | undefined;
  private renewing = false;
  private lastRenewAt = Date.now();
  private closing = false;
  private closed = false;
  private readonly store: DurableStore;
  private closePromise: Promise<void> | undefined;
  private failure: unknown;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private readonly tasks: TaskScheduler;
  private readonly limitValues: DurableLimits;
  /**
   * MCP fingerprints for pinned registrations, computed once when an agent is opened. The owned
   * agent task path (spawnAgent) runs inside a synchronous transaction and reads this map, so no
   * path can create a run without the fingerprint the registration is checked against.
   */
  private readonly mcpServers = new Map<string, DurableMcpServers>();
  /** Tool-index fingerprints for the same synchronous path; see `mcpServers`. */
  private readonly toolIndexes = new Map<string, DurableToolIndexes>();

  private constructor(
    store: DurableStore,
    agents: Map<string, DurableAgentRegistration>,
    private readonly maxConcurrentRuns: number,
    definitions: ReadonlyMap<string, RegisteredTask>,
    maxConcurrentTasks: number,
    limits: DurableLimits,
    private readonly onFatalError?: (error: unknown) => void,
    private readonly onCompatibility?: (report: readonly DurableAgentCompatibility[]) => void,
    worker?: ResolvedWorker,
  ) {
    this.agents = agents;
    this.worker = worker;
    this.store = guardStore(
      worker === undefined ? store : fenceStore(store),
      (error) => this.fail(error),
      limits,
    );
    this.limitValues = { ...limits };
    this.tasks = new TaskScheduler(
      this.store,
      definitions,
      maxConcurrentTasks,
      (error) => this.fail(error),
      agents,
      this.mcpServers,
      this.toolIndexes,
      (id) => this.active.has(id),
      async (root) => {
        const tasks = await this.store.transaction(async (tx) => tx.taskTree(root));
        for (const task of tasks)
          if (task.agentRunId !== undefined && task.status === "cancelling")
            this.active.get(task.agentRunId)?.controller.abort(new Error("Owner task cancelled."));
        await this.pump();
      },
      worker === undefined ? undefined : { workerId: worker.workerId, leaseMs: worker.leaseMs },
    );
  }

  static async open(options: DurableRuntimeOptions): Promise<DurableRuntime> {
    const maxConcurrentRuns = options.maxConcurrentRuns ?? 4;

    if (
      !Number.isSafeInteger(maxConcurrentRuns) ||
      maxConcurrentRuns < 1 ||
      maxConcurrentRuns > 1000
    )
      throw new TypeError("maxConcurrentRuns must be an integer between 1 and 1000.");

    const maxConcurrentTasks = options.maxConcurrentTasks ?? 4;

    if (
      !Number.isSafeInteger(maxConcurrentTasks) ||
      maxConcurrentTasks < 1 ||
      maxConcurrentTasks > 1000
    )
      throw new TypeError("maxConcurrentTasks must be an integer between 1 and 1000.");

    const pollIntervalMs = options.pollIntervalMs;

    if (
      pollIntervalMs !== undefined &&
      (!Number.isSafeInteger(pollIntervalMs) ||
        pollIntervalMs < 1 ||
        pollIntervalMs > 2_147_483_647)
    )
      throw new TypeError("pollIntervalMs must be a positive integer.");

    const definitions = new Map<string, RegisteredTask>();
    for (const { registration } of options.tasks ?? []) {
      if (registration.name === agentTask.name)
        throw new TypeError("Reserved task name: anvia.agent");

      if (definitions.has(registration.name))
        throw new TypeError(`Duplicate task definition: ${registration.name}`);

      definitions.set(registration.name, registration);
    }
    const worker = resolveWorker(options);
    const agents = registrations(await resolveAutoVersions(options.agents ?? []));
    const limits = durableLimits(options.limits);
    await (worker === undefined ? options.store.acquire() : options.store.join!());
    const runtime = new DurableRuntime(
      options.store,
      agents,
      maxConcurrentRuns,
      definitions,
      maxConcurrentTasks,
      limits,
      options.onFatalError,
      options.onCompatibility,
      worker,
    );
    try {
      await runtime.fingerprintPinnedAgents([...agents.keys()]);
    } catch (error) {
      await runtime.close();
      throw error;
    }
    runtime.notifyCompatibility();
    const polling = pollIntervalMs ?? (worker === undefined ? undefined : 1000);

    if (polling !== undefined) runtime.startPolling(polling);

    if (worker !== undefined) runtime.startWorkerHeartbeat(worker);

    return runtime;
  }

  /** Validate and add immutable registrations without restarting running work.
   * Existing IDs cannot be replaced. Registration does not retry blocked runs.
   */
  registerAgents(values: readonly DurableAgentRegistration[]): void {
    this.assertOpen();
    for (const value of values)
      if (value.version === AUTO_VERSION)
        throw new TypeError(
          `Durable agent "${value.agent.id}" uses version "auto", which is resolved in DurableRuntime.open(). Pass \`version: await agentVersion(agent)\` here instead.`,
        );
    const added = registrations(values);
    for (const id of added.keys())
      if (this.agents.has(id)) throw new DurableConflictError(`Agent already registered: ${id}`);
    // A pinned MCP fingerprint reads tool definitions, which may be asynchronous. It cannot be
    // computed here without making registration async, so pinned servers are registered at open().
    for (const [id, registration] of added)
      if (registration.mcpServers !== undefined)
        throw new TypeError(
          `Durable agent "${id}" pins MCP servers. Register it in DurableRuntime.open() so its server fingerprint is computed before any run starts.`,
        );
    for (const [id, registration] of added) this.agents.set(id, registration);
    this.notifyCompatibility();
  }

  /**
   * Register one agent and return a typed handle for it. It follows `registerAgents()` rules, so an
   * agent that pins MCP servers must be passed to `open()` and fetched with `handle()`.
   */
  agent<Output>(
    registration: DurableAgentRegistration & { agent: Agent<Output> },
  ): DurableAgentHandle<Output> {
    this.registerAgents([registration]);
    return new DurableAgentHandle<Output>(registration.agent.id, this);
  }

  /** A typed handle for an agent already registered, for example through `open({ agents })`. */
  handle<Output>(agent: Agent<Output>): DurableAgentHandle<Output> {
    this.assertOpen();

    if (!this.agents.has(agent.id))
      throw new DurableNotFoundError(`Unknown durable agent: ${agent.id}`);

    return new DurableAgentHandle<Output>(agent.id, this);
  }

  /** Stores the MCP and tool-index fingerprints of the given agents for the synchronous paths. */
  private async fingerprintPinnedAgents(agentIds: readonly string[]): Promise<void> {
    const servers = await mcpServersByAgent(this.agents, agentIds);
    for (const [id, value] of servers) this.mcpServers.set(id, value);
    const indexes = await toolIndexesByAgent(this.agents, agentIds);
    for (const [id, value] of indexes) this.toolIndexes.set(id, value);
  }

  /** Effective admission and payload budgets, after defaults. Returns a detached copy. */
  limits(): DurableLimits {
    const { maxPayloadBytes, ...rest } = this.limitValues;
    return {
      ...rest,
      maxPayloadBytes:
        typeof maxPayloadBytes === "number" ? maxPayloadBytes : { ...maxPayloadBytes },
    };
  }

  /** Detached, immutable compatibility report for every current registration. */
  compatibility(): readonly DurableAgentCompatibility[] {
    this.assertOpen();
    return compatibilityReport(this.agents);
  }

  private notifyCompatibility(): void {
    if (this.onCompatibility === undefined) return;

    // A host logging hook must never change whether open or registerAgents succeeds.
    try {
      void Promise.resolve(this.onCompatibility(compatibilityReport(this.agents))).catch(() => {});
    } catch {
      // Ignore: the report is advisory.
    }
  }

  /** Release an idle registration, preserving journal history and outcomes.
   * Re-register compatible code before retrying a failed run or spawning new work.
   */
  async unregisterAgent(id: string): Promise<boolean> {
    this.assertOpen();
    nonblank(id, "Agent ID");

    if (!this.agents.has(id)) return false;

    if ([...this.active.values()].some((run) => run.agentId === id))
      throw new DurableConflictError(`Agent still has an active attempt: ${id}`);

    // A shared worker only gives up claiming the agent: unfinished runs wait for a worker that
    // registers it, so they are not a reason to refuse. An owner would strand them.
    if (this.worker === undefined)
      for (const status of [
        "queued",
        "pending",
        "running",
        "retry_wait",
        "waiting",
        "needs_attention",
      ] as const)
        if ((await this.store.list({ agentId: id, status, limit: 1 })).runs.length)
          throw new DurableConflictError(`Agent still has unfinished work: ${id}`);

    return this.agents.delete(id);
  }

  /** Submit one persistent objective using a goal definition registered in options.tasks. */
  async submitGoal(
    definition: DefinedGoal,
    input: GoalInput & {
      sessionId: string;
      requestId: string;
      trace?: DurableTraceOptions | undefined;
    },
  ): Promise<DurableTaskHandle<GoalResult>> {
    const { sessionId, requestId, trace, ...goal } = input;
    return this.submitTask(definition, { sessionId, requestId, input: goal, trace });
  }

  /** `trace` applies to every agent run in the task tree and is ignored for deduplication. */
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
    const id = await this.tasks.submit(
      definition.name,
      definition.version,
      input.input,
      input.sessionId,
      input.requestId,
      undefined,
      parseTraceOptions(input.trace),
    );
    return new DurableTaskHandle<R>(id, this.tasks, this.store, () => this.assertOpen());
  }

  /** Resolve effective agents for authorization without persisting or scheduling a task. */
  async taskSubmissionScope(input: TaskSubmission): Promise<{
    sessionId: string;
    taskName: string;
    agentIds: string[];
  }> {
    this.assertOpen();
    const submission = parseTaskSubmission(input);
    return this.tasks.submissionScope(
      submission.name,
      submission.version,
      submission.input,
      submission.sessionId,
      submission.requestId,
    );
  }

  async submitRegisteredTask(
    input: TaskSubmission,
    options: { expectedAgentIds?: readonly string[] } = {},
  ): Promise<DurableTaskHandle> {
    this.assertOpen();
    const submission = parseTaskSubmission(input);
    const id = await this.tasks.submit(
      submission.name,
      submission.version,
      submission.input,
      submission.sessionId,
      submission.requestId,
      options.expectedAgentIds,
      submission.trace,
    );
    return new DurableTaskHandle(id, this.tasks, this.store, () => this.assertOpen());
  }

  /** Owning scope for authorization without loading operation journals or graph results. */
  async runScope(runId: string): Promise<DurableRunScope> {
    this.assertOpen();
    return readRunScope(this.store, runId);
  }

  async getTask(id: string): Promise<DurableTaskHandle> {
    this.assertOpen();
    await this.tasks.snapshot(id);
    return new DurableTaskHandle(id, this.tasks, this.store, () => this.assertOpen());
  }

  async listTasks(options: TaskListOptions = {}) {
    this.assertOpen();
    return this.store.listTasks(taskListSchema.parse(options));
  }

  async taskGraph(id: string) {
    this.assertOpen();
    return this.tasks.graph(id);
  }

  async submit(input: DurableSubmission, options: DurableSubmitOptions = {}): Promise<DurableRun> {
    this.assertOpen();
    const submission = parseSubmission(input, options);
    const registration = this.agents.get(input.agentId);

    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${input.agentId}`);

    // Fingerprinted before the transaction: server and index metadata is read asynchronously.
    const mcpServers = await mcpServersByAgent(this.agents, [input.agentId]);
    const toolIndexes = await toolIndexesByAgent(this.agents, [input.agentId]);
    const id = await submitRun(
      this.store,
      submission,
      options,
      (tx) =>
        createRunRecord(
          submission,
          registration,
          tx,
          mcpServers.get(input.agentId),
          toolIndexes.get(input.agentId),
        ),
      () => [...this.active.values()].some((active) => active.sessionId === input.sessionId),
    );
    await this.pump();
    return new DurableRun(id, this);
  }

  async submitGraph(input: DurableGraphSubmission): Promise<DurableTaskGraph> {
    this.assertOpen();
    const submission = parseDurableGraphSubmission(input);
    const agentIds = submission.tasks.map((task) => task.agentId);
    const mcpServers = await mcpServersByAgent(this.agents, agentIds);
    const toolIndexes = await toolIndexesByAgent(this.agents, agentIds);
    const id = await this.store.transaction(async (tx) =>
      createGraph(tx, submission, this.agents, mcpServers, toolIndexes, this.worker !== undefined),
    );
    await this.pump();
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

  async cancelGraph(id: string): Promise<void> {
    this.assertOpen();
    const ids = await cancelGraphRuns(this.store, id);
    for (const runId of ids)
      this.active.get(runId)?.controller.abort(new Error("Durable graph cancelled."));
    await this.pump();
  }

  async listRuns(options: DurableListOptions = {}): Promise<DurableRunPage> {
    this.assertOpen();
    return this.store.list(listOptionsSchema.parse(options));
  }

  async getRun(id: string): Promise<DurableRun> {
    await this.run(id);
    return new DurableRun(id, this);
  }

  /** Discover recoverable work. This does not wait for runs or approvals to finish. */
  async resume(): Promise<void> {
    this.assertOpen();
    await this.pump();

    if (this.worker === undefined) await this.tasks.resume();
  }

  /** Abort in-flight attempts, retain checkpoints, and release ownership after callbacks settle. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;

    this.closing = true;
    clearTimeout(this.wakeTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.workerTimer);
    for (const { controller } of this.active.values())
      controller.abort(new Error("Durable runtime closed."));
    this.closePromise = Promise.all([
      this.tasks.close(),
      ...[...this.active.values()].map(({ task }) => task),
    ]).then(async () => {
      try {
        await this.store.close();
      } finally {
        this.closed = true;
      }
    });
    return this.closePromise;
  }

  /** Read only the run record, without decoding any operation records. */
  async run(id: string): Promise<DurableRunRecord> {
    this.assertOpen();
    return readRun(this.store, id);
  }

  /** Bounded status projection, independent of transcript and operation count. */
  async status(id: string): Promise<DurableRunSummary> {
    this.assertOpen();
    return readStatus(this.store, id);
  }

  /** Rebuild one model request, including legacy embedded requests. */
  async operationRequest(id: string, key: string): Promise<CompletionRequest> {
    this.assertOpen();
    return this.store.transaction(async (tx) => {
      await requireRun(tx, id);
      const operation = await tx.getOperation(id, key);

      if (operation === undefined) throw new DurableNotFoundError("Durable operation not found.");

      if (operation.kind !== "model") throw new TypeError("Operation is not a model request.");

      return (await tx.blobs((io) =>
        hydrateValue(
          io,
          json((operation.input as unknown as { request: CompletionRequest }).request),
        ),
      )) as CompletionRequest;
    });
  }

  async snapshot(id: string, options: { operations?: boolean } = {}): Promise<DurableSnapshot> {
    this.assertOpen();
    return readSnapshot(this.store, id, options);
  }

  async events(id: string, after: number) {
    this.assertOpen();
    return readEvents(this.store, id, after);
  }

  async steer(
    id: string,
    input: AgentSteerInput,
    options: DurableSteerOptions = {},
  ): Promise<AgentSteerReceipt> {
    this.assertOpen();
    const receipt = await steerRun(this.store, id, input, options);
    await this.pump();
    return receipt;
  }

  async respond(id: string, interactionId: string, value: AgentInteractionResponse): Promise<void> {
    this.assertOpen();
    await respondToRun(this.store, id, interactionId, value);
    await this.pump();
  }

  async resolveTool(id: string, operationId: string, output: ToolResultOutput): Promise<void> {
    this.assertOpen();
    await resolveToolForRun(this.store, id, operationId, output);
    await this.pump();
  }

  /**
   * Settles a memory write that blocked a run, either because the store reported a conflict or
   * because the write's outcome is unknown. `applied` says the store already holds the messages;
   * `discarded` drops them. The run then continues with its remaining writes. `retry()` only sends
   * the same write again, so it cannot clear a conflict.
   */
  async resolveMemoryWrite(
    id: string,
    operationKey: string,
    resolution: MemoryWriteResolution,
  ): Promise<void> {
    this.assertOpen();
    await resolveMemoryWriteForRun(this.store, id, operationKey, resolution);
    await this.pump();
  }

  async retry(id: string): Promise<void> {
    this.assertOpen();

    if (this.active.has(id)) throw new DurableConflictError("Run is still settling.");

    // A run whose admission transaction rolled back has no committed history. Rebuild it from
    // the session before execution so a retry never runs with less context than the original
    // attempt; an over-limit history rejects the retry and leaves the run failed.
    await retryRun(this.store, id, (tx, run) =>
      inheritSessionHistory(tx, run, this.recordsMemory(run.agentId)),
    );
    await this.pump();
  }

  async cancel(id: string): Promise<void> {
    this.assertOpen();
    const sessionId = await cancelRun(this.store, id);
    this.active.get(id)?.controller.abort(new Error("Durable run cancelled."));

    if (sessionId.startsWith(TASK_SESSION_PREFIX))
      await this.tasks.agentChanged(sessionId.slice(TASK_SESSION_PREFIX.length));

    await this.pump();
  }

  /** Pumps run one at a time: scheduling reads the store, so two overlapping pumps could launch one run twice. */
  private pump(): Promise<void> {
    const next = this.pumpTail.then(() => this.pumpOnce());
    this.pumpTail = next.catch(() => undefined);
    return next;
  }

  private async pumpOnce(): Promise<void> {
    if (this.closing || this.failure !== undefined) return;

    clearTimeout(this.wakeTimer);
    const capacity = this.maxConcurrentRuns - this.active.size;

    if (capacity <= 0) return;

    if (this.worker !== undefined) {
      let claims: DurableClaim[];
      try {
        claims = await this.store.claim!({
          workerId: this.worker.workerId,
          now: new Date().toISOString(),
          limit: capacity,
          leaseMs: this.worker.leaseMs,
          agentIds: [...this.agents.keys()],
        });
      } catch {
        // A transient store error retries on the next beat instead of ending the worker.
        this.wakeTimer = setTimeout(() => {
          this.pump().catch((error: unknown) => this.fail(error));
        }, this.worker.heartbeatMs);
        this.wakeTimer.unref();
        return;
      }
      for (const claim of claims) await this.launch(claim.runId, claim);
      return;
    }

    const candidates = await this.store.schedule(
      new Date().toISOString(),
      capacity,
      [...this.active.values()].map((active) => active.sessionId),
    );
    for (const id of candidates.ids) await this.launch(id);

    if (candidates.nextAttemptAt !== undefined) {
      this.wakeTimer = setTimeout(
        async () => {
          try {
            await this.pump();
          } catch (error) {
            this.fail(error);
          }
        },
        Math.max(1, Math.min(2_147_483_647, Date.parse(candidates.nextAttemptAt) - Date.now())),
      );
      this.wakeTimer.unref();
    }
  }

  private pumpTail: Promise<void> = Promise.resolve();

  private async launch(id: string, claim?: DurableClaim): Promise<void> {
    if (this.active.has(id) || this.closing) return this.releaseClaim(claim);

    const { status, sessionId, agentId } = await this.run(id);

    if (this.closing || this.active.has(id)) return this.releaseClaim(claim);

    if (!["queued", "pending", "running", "retry_wait"].includes(status))
      return this.releaseClaim(claim);

    // The agent may have been unregistered between claiming and here. Leave the run for a worker
    // that registers it; there is no await between this check and `active.set` below.
    if (this.worker !== undefined && !this.agents.has(agentId)) return this.releaseClaim(claim);

    const controller = new AbortController();
    const fenced = <T>(fn: () => Promise<T>): Promise<T> =>
      claim === undefined ? fn() : claimContext.run({ runId: id, claimId: claim.claimId }, fn);
    const task = fenced(() => Promise.resolve().then(() => this.execute(id, controller.signal)))
      .catch(async (error: unknown) => {
        if (error instanceof DurableClaimLostError) return;

        if (!(error instanceof DurableLimitError)) throw error;

        // Admission failed, so no work is pending: settle terminally so result() and the
        // event stream end instead of waiting for an operator action that cannot help.
        await fenced(() =>
          this.store.transaction(async (tx) => {
            const run = await requireRun(tx, id);

            if (SETTLED.includes(run.status)) return;

            run.error = error.message;
            delete run.nextAttemptAt;
            await setStatus(tx, run, "failed");
          }),
        );
      })
      .finally(async () => {
        this.active.delete(id);
        await this.releaseClaim(claim);

        if (
          !this.closing &&
          this.failure === undefined &&
          sessionId.startsWith(TASK_SESSION_PREFIX)
        )
          await this.tasks.agentChanged(sessionId.slice(TASK_SESSION_PREFIX.length));

        if (!this.closing && this.failure === undefined) await this.pump();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof DurableClaimLostError) return;

        this.fail(error);
      });
    this.active.set(id, { agentId, sessionId, controller, task, claim });
  }

  /** Gives a claim back so another worker can take the run (or the session's next run) at once. */
  private async releaseClaim(claim: DurableClaim | undefined): Promise<void> {
    if (claim === undefined || this.failure !== undefined) return;

    try {
      await this.store.release!([{ runId: claim.runId, claimId: claim.claimId }]);
    } catch {
      // The lease lapses on its own if the release did not reach the store.
    }
  }

  /** Recorded memory supplies a run's history, so the previous run's history is not copied in. */
  private recordsMemory(agentId: string): boolean {
    const registration = this.agents.get(agentId);
    return registration !== undefined && recordedMemoryOf(registration) !== undefined;
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // A client-submitted run is admitted here, from this worker's registration. Server and index
    // fingerprints are read before the transaction because they are asynchronous.
    const pending = await this.run(id);
    const admission =
      pending.unadmitted === true && this.agents.has(pending.agentId)
        ? {
            mcpServers: await mcpServersByAgent(this.agents, [pending.agentId]),
            toolIndexes: await toolIndexesByAgent(this.agents, [pending.agentId]),
          }
        : undefined;
    const run = await this.store.transaction(async (tx) => {
      let current = await requireRun(tx, id);

      if (!["queued", "pending", "running", "retry_wait"].includes(current.status))
        return undefined;

      if (current.unadmitted === true) {
        const registration = this.agents.get(current.agentId);

        if (registration === undefined || admission === undefined) {
          current.error = `Agent is not registered on this worker: ${current.agentId}`;
          await setStatus(tx, current, "failed");
          return undefined;
        }

        if (current.graphId !== undefined) {
          try {
            assertMemoryFreeTask(registration, current.agentId, "graph tasks");
          } catch (error) {
            current.error = errorMessage(error);
            await setStatus(tx, current, "failed");
            return undefined;
          }
        }

        current = await admitRunRecord(
          current,
          registration,
          tx,
          admission.mcpServers.get(current.agentId),
          admission.toolIndexes.get(current.agentId),
        );
      }

      if (current.status === "queued")
        await inheritSessionHistory(tx, current, this.recordsMemory(current.agentId));

      current.startedAt ??= new Date().toISOString();
      delete current.nextAttemptAt;
      delete current.error;
      await setStatus(tx, current, "running");
      return current;
    });

    if (run === undefined) return;

    if (run.sessionId.startsWith(TASK_SESSION_PREFIX))
      await this.tasks.agentChanged(run.sessionId.slice(TASK_SESSION_PREFIX.length));

    try {
      const registration = this.agents.get(run.agentId);

      if (registration === undefined || registration.version !== run.version) {
        throw new DurableRecoveryError(
          AUTO_VERSION_PATTERN.test(run.version)
            ? "The saved agent version is not registered: the agent's declared configuration (model, instructions, tools, or settings) changed since this run started. Restore it before retrying."
            : "The saved agent version is not registered. Restore it before retrying.",
        );
      }

      verifyContextDocuments(run, registration);
      await verifyMcpServers(run, registration);
      await verifyToolIndexes(run, registration);
      verifyVectorContext(run, registration);
      const memory = recordedMemoryOf(registration);

      // A checkpoint from an earlier attempt means the model work is finished: only the memory
      // writes after it can remain, so the agent is not run again.
      if (run.outcome === undefined) {
        await prepareContext(this.store, run, registration, signal);
        const trace = await this.store.transaction(async (tx) => runTrace(tx, run));
        // Stored records may carry blob references; the agent loop always sees restored content.
        const input = (await this.store.transaction(
          async (tx) => await tx.blobs((io) => hydrateValue(io, json(run.input))),
        )) as DurableRunRecord["input"];
        // Core's appends are captured here and written only after the checkpoint below.
        const captured: MemoryAppendOptions[] = [];
        const options = withInternalAgentRunOptions(
          {
            ...input,
            trace,
            abortSignal: signal,
            retries: false as const,
            toolConcurrency: registration.toolConcurrency,
          },
          {
            runId: id,
            execution: createExecution(this.store, run, registration, signal),
            hook: createRecordedHooks(this.store, run, registration),
            lifecycle: createObservedLifecycle(this.store, run, registration),
            guardrails: createRecordedGuardrails(this.store, run, registration),
            memory:
              memory === undefined
                ? undefined
                : {
                    store: recordedMemoryStore({
                      store: this.store,
                      run,
                      source: memory.store,
                      captured,
                      signal,
                    }),
                    scope: { sessionId: run.sessionId },
                  },
          },
        );
        const outcome =
          run.stream === true
            ? await registration.agent.stream(options).result
            : await registration.agent.generate(options);
        signal.throwIfAborted();
        await this.store.transaction(async (tx) => {
          const current = await requireRun(tx, id);

          // Settled elsewhere (cancelled by a client or another worker): never overwrite it.
          if (SETTLED.includes(current.status)) return;

          current.outcome = (await tx.blobs((io) =>
            externalizeOutcome(io, json({ ...outcome, usage: current.usage })),
          )) as AgentOutcome<unknown>;

          if (captured.length === 0) {
            await setStatus(tx, current, outcome.type === "interaction" ? "waiting" : "completed");
            return;
          }

          // The run stays running until its memory writes finish, so a crash here resumes them.
          await recordMemoryWrites(tx, current, captured);
          await tx.putRun(current);
        });
      }

      if (memory !== undefined) {
        await flushRecordedMemory({ store: this.store, run, source: memory.store, signal });
        await this.store.transaction(async (tx) => {
          const current = await requireRun(tx, id);

          if (current.status !== "running") return;

          await setStatus(
            tx,
            current,
            current.outcome?.type === "interaction" ? "waiting" : "completed",
          );
        });
      }
    } catch (error) {
      if (error instanceof DurableStorageError || error instanceof DurableClaimLostError)
        throw error;

      if (signal.aborted) return;

      await this.store.transaction(async (tx) => {
        const current = await requireRun(tx, id);

        if (SETTLED.includes(current.status)) return;

        current.error = errorMessage(error);

        if (error instanceof MaxTurnsError)
          current.exhaustion = {
            reason: "max_turns",
            messages: await tx.blobs((io) => externalizeMessages(io, error.chatHistory)),
          };

        if (error instanceof DurableRecoveryError && error.operationId !== undefined)
          current.blockedOperation = error.operationId;

        if (
          error instanceof DurableModelError &&
          current.modelRetry !== undefined &&
          error.attempts < current.modelRetry.maxAttempts
        ) {
          const delay = Math.min(
            current.modelRetry.maxDelayMs,
            current.modelRetry.initialDelayMs * 2 ** (error.attempts - 1),
          );
          current.nextAttemptAt = new Date(Date.now() + delay).toISOString();
          await setStatus(tx, current, "retry_wait");
        } else {
          await setStatus(
            tx,
            current,
            error instanceof DurableRecoveryError ? "needs_attention" : "failed",
          );
        }
      });
    }
  }

  async metrics() {
    this.assertOpen();
    return this.store.metrics();
  }

  /** Does not touch storage, so supervisors can inspect a failed owner. */
  health() {
    let status: "closed" | "closing" | "failed" | "ready" = "ready";

    if (this.closed) {
      status = "closed";
    } else if (this.closing) {
      status = "closing";
    } else if (this.failure !== undefined) {
      status = "failed";
    }

    return {
      status,
      ready: !this.closing && this.failure === undefined,
      activeRuns: this.active.size,
      activeTasks: this.tasks.activeCount,
    };
  }

  /**
   * Notices changes another process wrote to the store: schedules runs that became eligible and
   * aborts an active attempt whose run was cancelled elsewhere. A tick is skipped while the
   * previous one is still running, so a slow store cannot pile up reads.
   */
  private startPolling(intervalMs: number): void {
    this.pollTimer = setInterval(() => {
      if (this.polling || this.closing || this.failure !== undefined) return;

      this.polling = true;
      void this.poll()
        .catch((error: unknown) => {
          if (!this.closing) this.fail(error);
        })
        .finally(() => {
          this.polling = false;
        });
    }, intervalMs);
    this.pollTimer.unref();
  }

  private async poll(): Promise<void> {
    for (const [id, active] of this.active) {
      if (active.controller.signal.aborted) continue;

      const { status } = await this.status(id);

      if (status === "cancelled") active.controller.abort(new Error("Durable run cancelled."));
    }

    if (this.worker !== undefined) await this.tasks.poll();

    await this.pump();
  }

  /** Renews held claims and stops runs whose claim was lost. */
  private startWorkerHeartbeat(worker: ResolvedWorker): void {
    this.workerTimer = setInterval(() => {
      if (this.renewing || this.closing || this.failure !== undefined) return;

      this.renewing = true;
      void this.renewClaims(worker)
        .catch(() => {
          // A transient failure retries on the next beat. Once a full lease passes without a
          // successful renewal another worker may hold these runs, so stop them.
          if (Date.now() - this.lastRenewAt > worker.leaseMs) this.abortAllClaims();
        })
        .finally(() => {
          this.renewing = false;
        });
    }, worker.heartbeatMs);
    this.workerTimer.unref();
  }

  private async renewClaims(worker: ResolvedWorker): Promise<void> {
    const held: DurableClaim[] = [
      ...[...this.active.values()].flatMap((active) =>
        active.claim === undefined ? [] : [active.claim],
      ),
      ...this.tasks.heldClaims(),
    ];

    if (held.length === 0) {
      this.lastRenewAt = Date.now();
      return;
    }

    const { lost } = await this.store.renew!({
      workerId: worker.workerId,
      claims: held.map((claim) => ({ runId: claim.runId, claimId: claim.claimId })),
      leaseMs: worker.leaseMs,
    });
    this.lastRenewAt = Date.now();
    for (const id of lost) {
      const active = this.active.get(id);

      if (active?.claim !== undefined)
        active.controller.abort(new DurableClaimLostError(id, active.claim.claimId));

      this.tasks.lose(id);
    }
  }

  private abortAllClaims(): void {
    for (const [runId, active] of this.active)
      if (active.claim !== undefined)
        active.controller.abort(new DurableClaimLostError(runId, active.claim.claimId));
    for (const claim of this.tasks.heldClaims()) this.tasks.lose(claim.runId);
  }

  private fail(error: unknown): void {
    if (this.failure !== undefined) return;

    this.failure = error;
    clearTimeout(this.wakeTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.workerTimer);
    this.tasks?.stop(error);
    for (const active of this.active.values()) active.controller.abort(error);
    // Diagnostics must never replace the journal failure or create an unhandled rejection.
    try {
      void Promise.resolve(this.onFatalError?.(error)).catch(() => {});
    } catch {}
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Durable runtime is closed.");

    if (this.failure !== undefined) throw this.failure;
  }
}

/**
 * A run replays with the context documents frozen at submission. A registration resolving to a
 * different set under the same version fails the run instead of silently changing context.
 */
function verifyContextDocuments(
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): void {
  const current = contextDocumentsOf(registration.agent);
  const expected = run.contextDocuments?.hash;

  if (expected !== current?.hash)
    throw new DurableRecoveryError(
      `Context documents changed for durable agent "${run.agentId}": the run recorded hash ${expected ?? "none"}, but the registration now resolves ${current?.hash ?? "none"}. Restore the original documents, or bump the registration version.`,
    );
}

/**
 * A run calls the MCP servers it was submitted with. A registration whose servers (tool lists or
 * definitions) fingerprint differently under the same version fails the run before any model call.
 */
async function verifyMcpServers(
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): Promise<void> {
  const current = await mcpServersOf(registration.agent);
  const expected = run.mcpServers?.hash;

  if (expected !== current?.hash)
    throw new DurableRecoveryError(
      `MCP servers changed for durable agent "${run.agentId}": the run recorded fingerprint ${expected ?? "none"}, but the registration now resolves ${current?.hash ?? "none"}. Restore the original servers and tool lists, or bump the registration version.`,
    );
}

/**
 * A run selects tools with the fingerprint frozen at submission. A registration whose indexes
 * fingerprint differently under the same version fails the run instead of silently changing the
 * tools offered to the model.
 */
async function verifyToolIndexes(
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): Promise<void> {
  const current = await toolIndexesOf(registration.agent);
  const expected = run.toolIndexes?.hash;

  if (expected !== current?.hash)
    throw new DurableRecoveryError(
      `Tool indexes changed for durable agent "${run.agentId}": the run recorded fingerprint ${expected ?? "none"}, but the registration now resolves ${current?.hash ?? "none"}. Restore the original tool indexes, or bump the registration version.`,
    );
}

/**
 * A run retrieves with the vector context settings frozen at submission. A registration that
 * fingerprints differently under the same version fails the run instead of silently changing what
 * the model is shown. The fingerprint does not cover the embedding model's internals.
 */
function verifyVectorContext(run: DurableRunRecord, registration: DurableAgentRegistration): void {
  const current =
    registration.context === undefined ? undefined : vectorContextOf(registration.agent);
  const expected = run.vectorContext?.hash;

  if (expected !== current?.hash)
    throw new DurableRecoveryError(
      `Vector context changed for durable agent "${run.agentId}": the run recorded fingerprint ${expected ?? "none"}, but the registration now resolves ${current?.hash ?? "none"}. Restore the original vector context, or bump the registration version.`,
    );
}

const SETTLED = SETTLED_STATUSES;

/**
 * Copy a run's inherited conversation into the record before execution. A continued run picks up
 * that run's whole conversation; a turn-limited one keeps its partial work. Others continue their
 * session's latest settled run. Persisting this here keeps the invariant that a run record always
 * holds the history it will execute with, including after a rolled-back admission.
 */
async function inheritSessionHistory(
  tx: DurableTransaction,
  run: DurableRunRecord,
  recordsMemory: boolean,
): Promise<void> {
  if (run.graphId !== undefined) {
    run.input = { messages: [promptMessage(await graphInput(tx, run))] };
    return;
  }

  // Recorded memory holds the session's conversation; copying the previous run in would repeat it.
  if (recordsMemory) {
    run.history = [];
    run.input = { messages: [promptMessage(run.prompt)] };
    return;
  }

  const previous =
    run.continueFrom === undefined
      ? await tx.latestCompleted(run.sessionId)
      : await requireRun(tx, run.continueFrom);

  if (previous === undefined) {
    run.history = [];
  } else if (previous.status === "completed") {
    run.history = [...previous.history, ...(previous.outcome?.messages ?? [])];
  } else {
    run.history = await settledHistory(tx, previous);
  }

  if (previous?.contextCheckpoint !== undefined) run.contextCheckpoint = previous.contextCheckpoint;

  run.input = { messages: [...run.history, promptMessage(run.prompt)] };
}

type ResolvedWorker = { workerId: string; leaseMs: number; heartbeatMs: number };

function resolveWorker(options: DurableRuntimeOptions): ResolvedWorker | undefined {
  const worker = options.worker;

  if (worker === undefined) return undefined;

  const store = options.store;

  if (
    store.join === undefined ||
    store.claim === undefined ||
    store.renew === undefined ||
    store.release === undefined
  )
    throw new TypeError(
      "This store does not support shared workers. Use a single owning runtime, or a Postgres, Drizzle, or Prisma store.",
    );

  const workerId = worker.workerId ?? `worker-${globalThis.crypto.randomUUID()}`;
  nonblank(workerId, "workerId");
  const leaseMs = worker.leaseMs ?? 30_000;
  const heartbeatMs = worker.heartbeatMs ?? Math.max(1, Math.floor(leaseMs / 3));
  for (const [name, value] of [
    ["leaseMs", leaseMs],
    ["heartbeatMs", heartbeatMs],
  ] as const)
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new TypeError(`worker.${name} must be a positive integer.`);
  return { workerId, leaseMs, heartbeatMs };
}
