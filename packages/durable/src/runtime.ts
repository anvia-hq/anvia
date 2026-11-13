import { queueSteering } from "./steering.js";
import type { AgentOutcome, AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import { parsePrompt, promptMessage } from "./prompt.js";
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
import { createGraph, graphInput, graphSnapshot, requireGraph } from "./graph-state.js";
import { createRunRecord, GRAPH_SESSION_PREFIX } from "./run-record.js";
import type {
  DurableGraphSubmission,
  DurableGraphSnapshot,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";
import {
  assertAgentInteractionResponse,
  parseAgentInteractionResponse,
  type AgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import {
  parseMessage,
  type CompletionRequest,
  type ToolResultOutput,
} from "@anvia/core/completion";
import type { MemoryAppendOptions } from "@anvia/core/memory";
import { withInternalAgentRunOptions } from "@anvia/core/internal/agent";
import {
  DurableConflictError,
  DurableModelError,
  DurableNotFoundError,
  DurableRecoveryError,
  DurableStorageError,
  DurableLimitError,
} from "./errors.js";
import { prepareContext } from "./compaction.js";
import { settledHistory } from "./settled-progress.js";
import {
  externalizeMessages,
  externalizeOutcome,
  externalizeSubmittedEvent,
  externalizeToolResult,
  hydrateValue,
} from "./blob.js";
import { contextDocumentsOf } from "./documents.js";
import { mcpServersByAgent, mcpServersOf, type DurableMcpServers } from "./mcp-servers.js";
import { toolIndexesByAgent, toolIndexesOf, type DurableToolIndexes } from "./tool-indexes.js";
import { vectorContextOf } from "./vector-context.js";
import { createExecution } from "./execution.js";
import { createObservedLifecycle } from "./observed-lifecycle.js";
import { createRecordedHooks } from "./recorded-hooks.js";
import { createRecordedGuardrails } from "./recorded-guardrails.js";
import {
  flushRecordedMemory,
  isRecordedMemoryWrite,
  resolveRecordedMemoryWrite,
  recordMemoryWrites,
  recordedMemoryOf,
  recordedMemoryStore,
} from "./recorded-memory.js";
import { runTrace } from "./trace.js";
import { parseTraceOptions } from "./trace-schema.js";
import { errorMessage, json, nonblank, sameJson } from "./json.js";
import { listOptionsSchema } from "./schema.js";
import { registrations } from "./registration.js";
import { compatibilityReport } from "./compatibility.js";
import { DurableRun } from "./run.js";
import type {
  DurableSteerOptions,
  DurableAgentCompatibility,
  DurableAgentRegistration,
  DurableListOptions,
  DurableOperation,
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

export class DurableRuntime {
  private readonly agents: Map<string, DurableAgentRegistration>;
  private readonly active = new Map<
    string,
    { agentId: string; sessionId: string; controller: AbortController; task: Promise<void> }
  >();
  private closing = false;
  private closed = false;
  private readonly store: DurableStore;
  private closePromise: Promise<void> | undefined;
  private failure: unknown;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
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
  ) {
    this.agents = agents;
    this.store = guardStore(store, (error) => this.fail(error), limits);
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
    const definitions = new Map<string, RegisteredTask>();
    for (const { registration } of options.tasks ?? []) {
      if (registration.name === agentTask.name)
        throw new TypeError("Reserved task name: anvia.agent");
      if (definitions.has(registration.name))
        throw new TypeError(`Duplicate task definition: ${registration.name}`);
      definitions.set(registration.name, registration);
    }
    const agents = registrations(options.agents ?? []);
    const limits = durableLimits(options.limits);
    await options.store.acquire();
    const runtime = new DurableRuntime(
      options.store,
      agents,
      maxConcurrentRuns,
      definitions,
      maxConcurrentTasks,
      limits,
      options.onFatalError,
      options.onCompatibility,
    );
    try {
      await runtime.fingerprintPinnedAgents([...agents.keys()]);
    } catch (error) {
      await runtime.close();
      throw error;
    }
    runtime.notifyCompatibility();
    return runtime;
  }

  /** Validate and add immutable registrations without restarting running work.
   * Existing IDs cannot be replaced. Registration does not retry blocked runs.
   */
  registerAgents(values: readonly DurableAgentRegistration[]): void {
    this.assertOpen();
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
    return this.store.transaction(async (tx) => {
      const run = await requireRun(tx, runId);
      const base = { runId, agentId: run.agentId, sessionId: run.sessionId };
      if (run.graphId !== undefined)
        return {
          ...base,
          sessionId: (await requireGraph(tx, run.graphId)).submission.sessionId,
          graphId: run.graphId,
          taskId: run.taskId!,
        };
      if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return base;
      const task = await tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
      if (task === undefined || task.agentRunId !== runId)
        throw new DurableNotFoundError("Owned task is missing.");
      return {
        ...base,
        sessionId: task.sessionId,
        taskId: task.id,
        rootTaskId: task.rootId,
        taskName: task.name,
      };
    });
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
    if (options.enqueue !== undefined && typeof options.enqueue !== "boolean")
      throw new TypeError("enqueue must be a boolean.");
    for (const key of ["agentId", "sessionId", "requestId"] as const) nonblank(input[key], key);
    if (
      input.sessionId.startsWith(GRAPH_SESSION_PREFIX) ||
      input.sessionId.startsWith(TASK_SESSION_PREFIX)
    )
      throw new TypeError("Reserved durable session ID.");
    const trace = parseTraceOptions(input.trace);
    const submission: DurableSubmission = {
      agentId: input.agentId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      prompt: parsePrompt(input.prompt),
    };

    if (trace !== undefined) {
      submission.trace = trace;
    }

    const registration = this.agents.get(input.agentId);
    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${input.agentId}`);
    // Fingerprinted before the transaction: server and index metadata is read asynchronously.
    const mcpServers = await mcpServersByAgent(this.agents, [input.agentId]);
    const toolIndexes = await toolIndexesByAgent(this.agents, [input.agentId]);
    const id = await this.store.transaction(async (tx) => {
      const existing = await tx.findRequest(input.sessionId, input.requestId);
      if (existing !== undefined) {
        if (existing.agentId !== input.agentId || !sameJson(existing.prompt, submission.prompt)) {
          throw new DurableConflictError("requestId already belongs to a different submission.");
        }
        return existing.id;
      }
      if (!options.enqueue && (await tx.activeRun(input.sessionId)) !== undefined)
        throw new DurableConflictError("Session already has unfinished work.");
      if (
        !options.enqueue &&
        [...this.active.values()].some((active) => active.sessionId === input.sessionId)
      ) {
        throw new DurableConflictError("Previous session execution is still settling.");
      }
      const run = await createRunRecord(
        submission,
        registration,
        tx,
        mcpServers.get(input.agentId),
        toolIndexes.get(input.agentId),
      );
      await tx.putRun(run);
      await tx.appendEvent(
        run.id,
        "submitted",
        json(await tx.blobs((io) => externalizeSubmittedEvent(io, submission))),
      );
      return run.id;
    });
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
      createGraph(tx, submission, this.agents, mcpServers, toolIndexes),
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
    return this.store.transaction(async (tx) => graphSnapshot(tx, id));
  }

  async graphEvents(id: string, after: number) {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
    return this.store.graphEvents(id, after, 100);
  }

  async cancelGraph(id: string): Promise<void> {
    this.assertOpen();
    const ids = await this.store.transaction(async (tx) => {
      const graph = await requireGraph(tx, id);
      if (graph.cancelled || (await graphSnapshot(tx, id)).status === "completed") return [];
      graph.cancelled = true;
      await tx.putGraph(graph);
      const runIds = Object.values(graph.runIds);
      for (const runId of runIds) {
        const run = await requireRun(tx, runId);
        if (["completed", "failed", "cancelled"].includes(run.status)) continue;
        delete run.nextAttemptAt;
        run.error = "Durable graph cancelled.";
        await setStatus(tx, run, "cancelled");
      }
      // Cancellation remains observable even when every task had already failed.
      await tx.appendEvent(runIds[0]!, "status", { graphCancelled: true });
      return runIds;
    });
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
    await this.tasks.resume();
  }

  /** Abort in-flight attempts, retain checkpoints, and release ownership after callbacks settle. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    clearTimeout(this.wakeTimer);
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
    return this.store.transaction(async (tx) => {
      const stored = await requireRun(tx, id);
      return (await tx.blobs((io) => hydrateValue(io, json(stored)))) as DurableRunRecord;
    });
  }

  /** Bounded status projection, independent of transcript and operation count. */
  async status(id: string): Promise<DurableRunSummary> {
    this.assertOpen();
    return this.store.transaction(async (tx) => {
      const summary = await tx.getRunSummary(id);
      if (summary === undefined) throw new DurableNotFoundError("Durable run not found.");
      return summary;
    });
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
    return this.store.transaction(async (tx) => {
      const stored = await requireRun(tx, id);
      const run = (await tx.blobs((io) => hydrateValue(io, json(stored)))) as DurableRunRecord;
      const operations: DurableOperation[] = [];
      if (options.operations !== false)
        for (const operation of await tx.operations(id))
          operations.push(
            (await tx.blobs((io) => hydrateValue(io, json(operation)))) as DurableOperation,
          );
      return { run, operations, cursor: await tx.cursor() };
    });
  }

  async events(id: string, after: number) {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
    return this.store.events(id, after, 100);
  }

  async steer(
    id: string,
    input: AgentSteerInput,
    options: DurableSteerOptions = {},
  ): Promise<AgentSteerReceipt> {
    this.assertOpen();
    const receipt = await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      await assertOwnedTaskMutable(tx, run);
      if (run.graphId !== undefined && (await requireGraph(tx, run.graphId)).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      return queueSteering(tx, run, input, options);
    });
    await this.pump();
    return receipt;
  }

  async respond(id: string, interactionId: string, value: AgentInteractionResponse): Promise<void> {
    this.assertOpen();
    nonblank(interactionId, "Interaction ID");
    const response = parseAgentInteractionResponse(value);
    await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      if (run.graphId !== undefined && (await requireGraph(tx, run.graphId)).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (Object.hasOwn(run.responses, interactionId)) {
        if (!sameJson(run.responses[interactionId], response))
          throw new DurableConflictError("Interaction already received a different response.");
        return;
      }
      await assertOwnedTaskMutable(tx, run);
      if (
        run.status !== "waiting" ||
        run.outcome?.type !== "interaction" ||
        run.outcome.interaction.id !== interactionId
      ) {
        throw new DurableConflictError("No matching pending interaction.");
      }
      try {
        assertAgentInteractionResponse(run.outcome.interaction, response);
      } catch (error) {
        throw new DurableConflictError(errorMessage(error));
      }
      run.responses[interactionId] = json(response);
      const continuation = run.outcome.continuation;
      // Core resumes with previous segments as history and returns messages from the new segment.
      run.history = [...run.history, ...run.outcome.messages];
      run.input = { continuation, response };
      run.epoch += 1;
      delete run.outcome;
      await setStatus(tx, run, "pending");
    });
    await this.pump();
  }

  async resolveTool(id: string, operationId: string, output: ToolResultOutput): Promise<void> {
    this.assertOpen();
    await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      await assertOwnedTaskMutable(tx, run);
      if (run.graphId !== undefined && (await requireGraph(tx, run.graphId)).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (run.status !== "needs_attention" || run.blockedOperation !== operationId) {
        throw new DurableConflictError("No matching tool awaiting reconciliation.");
      }
      const operation = await tx.getOperation(id, operationId);
      if (operation?.kind !== "tool" || operation.status !== "started")
        throw new DurableConflictError("Operation cannot be reconciled.");
      const checked = parseMessage({
        role: "tool",
        content: [{ type: "tool-result", toolCallId: operationId, toolName: "reconciled", output }],
      });
      if (checked.role !== "tool" || checked.content[0]?.type !== "tool-result")
        throw new TypeError("Invalid tool result.");
      // A reconciled output gets the same bounded-reference treatment as a live tool result.
      const reconciledOutput = checked.content[0].output;
      const result = await tx.blobs((io) =>
        externalizeToolResult(io, json({ output: reconciledOutput, failed: false })),
      );
      await tx.putOperation(id, { ...operation, status: "completed", result });
      await tx.appendEvent(id, "tool_completed", { operationId, result, reconciled: true });
      delete run.blockedOperation;
      delete run.error;
      await setStatus(tx, run, "pending");
    });
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
    if (resolution !== "applied" && resolution !== "discarded")
      throw new TypeError('resolution must be "applied" or "discarded".');
    await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      await assertOwnedTaskMutable(tx, run);
      if (run.status !== "needs_attention" || run.blockedOperation !== operationKey)
        throw new DurableConflictError("No matching memory write awaiting resolution.");
      const operation = await tx.getOperation(id, operationKey);
      if (
        operation === undefined ||
        !isRecordedMemoryWrite(operation) ||
        operation.status !== "started"
      )
        throw new DurableConflictError("Operation cannot be resolved.");
      await resolveRecordedMemoryWrite(tx, run, operation, resolution);
      delete run.blockedOperation;
      delete run.error;
      await setStatus(tx, run, "pending");
    });
    await this.pump();
  }

  async retry(id: string): Promise<void> {
    this.assertOpen();
    if (this.active.has(id)) throw new DurableConflictError("Run is still settling.");
    await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      await assertOwnedTaskMutable(tx, run);
      if (run.graphId !== undefined && (await requireGraph(tx, run.graphId)).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (run.status !== "failed" && run.status !== "needs_attention")
        throw new DurableConflictError("Only failed or blocked runs can be retried.");
      const other = await tx.activeRun(run.sessionId);
      if (other !== undefined && other.id !== id && other.status !== "queued")
        throw new DurableConflictError("Session already has unfinished work.");
      if (await tx.hasLaterStartedRun(id))
        throw new DurableConflictError("Session has advanced; create a new submission.");
      const operations = await tx.operations(id);
      // A run whose admission transaction rolled back has no committed history. Rebuild it from
      // the session before execution so a retry never runs with less context than the original
      // attempt; an over-limit history rejects the retry and leaves the run failed.
      if (run.graphId === undefined && run.history.length === 0 && operations.length === 0)
        await inheritSessionHistory(tx, run, this.recordsMemory(run.agentId));
      for (const operation of operations) {
        if (
          (operation.kind === "model" ||
            operation.kind === "compaction" ||
            operation.kind === "context" ||
            isRecordedMemoryWrite(operation)) &&
          operation.status === "started"
        )
          // An uncertain memory write is sent again only here, on an explicit retry; its key
          // makes a repeat of a committed write a duplicate.
          await tx.putOperation(id, { ...operation, attempts: 0 });
      }
      delete run.error;
      delete run.blockedOperation;
      delete run.exhaustion;
      run.retries = (run.retries ?? 0) + 1;
      await setStatus(tx, run, "pending");
    });
    await this.pump();
  }

  async cancel(id: string): Promise<void> {
    this.assertOpen();
    const sessionId = await this.store.transaction(async (tx) => {
      const run = await requireRun(tx, id);
      if (["completed", "failed", "cancelled"].includes(run.status)) return run.sessionId;
      delete run.nextAttemptAt;
      run.error = "Durable run cancelled.";
      await setStatus(tx, run, "cancelled");
      return run.sessionId;
    });
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

  private async launch(id: string): Promise<void> {
    if (this.active.has(id) || this.closing) return;
    const { status, sessionId, agentId } = await this.run(id);
    if (this.closing || this.active.has(id)) return;
    if (!["queued", "pending", "running", "retry_wait"].includes(status)) return;
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => this.execute(id, controller.signal))
      .catch(async (error: unknown) => {
        if (!(error instanceof DurableLimitError)) throw error;
        // Admission failed, so no work is pending: settle terminally so result() and the
        // event stream end instead of waiting for an operator action that cannot help.
        await this.store.transaction(async (tx) => {
          const run = await requireRun(tx, id);
          if (SETTLED.includes(run.status)) return;
          run.error = error.message;
          delete run.nextAttemptAt;
          await setStatus(tx, run, "failed");
        });
      })
      .finally(async () => {
        this.active.delete(id);
        if (
          !this.closing &&
          this.failure === undefined &&
          sessionId.startsWith(TASK_SESSION_PREFIX)
        )
          await this.tasks.agentChanged(sessionId.slice(TASK_SESSION_PREFIX.length));
        if (!this.closing && this.failure === undefined) await this.pump();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        this.fail(error);
      });
    this.active.set(id, { agentId, sessionId, controller, task });
  }

  /** Recorded memory supplies a run's history, so the previous run's history is not copied in. */
  private recordsMemory(agentId: string): boolean {
    const registration = this.agents.get(agentId);
    return registration !== undefined && recordedMemoryOf(registration) !== undefined;
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const run = await this.store.transaction(async (tx) => {
      const current = await requireRun(tx, id);
      if (!["queued", "pending", "running", "retry_wait"].includes(current.status))
        return undefined;
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
          "The saved agent version is not registered. Restore it before retrying.",
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
      if (error instanceof DurableStorageError) throw error;
      if (signal.aborted) return;
      await this.store.transaction(async (tx) => {
        const current = await requireRun(tx, id);
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
    return {
      status: this.closed
        ? ("closed" as const)
        : this.closing
          ? ("closing" as const)
          : this.failure !== undefined
            ? ("failed" as const)
            : ("ready" as const),
      ready: !this.closing && this.failure === undefined,
      activeRuns: this.active.size,
      activeTasks: this.tasks.activeCount,
    };
  }

  private fail(error: unknown): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    clearTimeout(this.wakeTimer);
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

async function requireRun(tx: DurableTransaction, id: string): Promise<DurableRunRecord> {
  const run = await tx.getRun(id);
  if (run === undefined) throw new DurableNotFoundError(`Unknown durable run: ${id}`);
  return run;
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

const SETTLED: readonly string[] = ["completed", "failed", "cancelled"];

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
  run.history =
    previous === undefined
      ? []
      : previous.status === "completed"
        ? [...previous.history, ...(previous.outcome?.messages ?? [])]
        : await settledHistory(tx, previous);
  if (previous?.contextCheckpoint !== undefined) run.contextCheckpoint = previous.contextCheckpoint;
  run.input = { messages: [...run.history, promptMessage(run.prompt)] };
}

async function setStatus(
  tx: DurableTransaction,
  run: DurableRunRecord,
  status: DurableRunRecord["status"],
): Promise<void> {
  run.status = status;
  run.updatedAt = new Date().toISOString();
  await tx.putRun(run);
  // Status events stay small: the outcome lives on the run record and clients read it from the
  // snapshot. Embedding it here duplicated every completed outcome in the journal (DUR-07).
  await tx.appendEvent(
    run.id,
    "status",
    json({
      status,
      error: run.error,
      blockedOperation: run.blockedOperation,
      nextAttemptAt: run.nextAttemptAt,
    }),
  );
}

async function assertOwnedTaskMutable(
  tx: DurableTransaction,
  run: DurableRunRecord,
): Promise<void> {
  if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return;
  const task = await tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
  if (
    task === undefined ||
    ["completing", "cancelling", "completed", "failed", "cancelled"].includes(task.status)
  )
    throw new DurableConflictError(
      "Owned task outcomes are immutable; create a new task submission.",
    );
}
