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
import { parseMessage, type ToolResultOutput } from "@anvia/core/completion";
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
import { createExecution } from "./execution.js";
import { errorMessage, json, nonblank, sameJson } from "./json.js";
import { listOptionsSchema } from "./schema.js";
import { registrations } from "./registration.js";
import { DurableRun } from "./run.js";
import type {
  DurableAgentRegistration,
  DurableListOptions,
  DurableRunPage,
  DurableSubmitOptions,
  DurableRunRecord,
  DurableRuntimeOptions,
  DurableSnapshot,
  DurableStore,
  DurableSubmission,
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

  private constructor(
    store: DurableStore,
    agents: Map<string, DurableAgentRegistration>,
    private readonly maxConcurrentRuns: number,
    definitions: ReadonlyMap<string, RegisteredTask>,
    maxConcurrentTasks: number,
    limits: DurableLimits,
    private readonly onFatalError?: (error: unknown) => void,
  ) {
    this.agents = agents;
    this.store = guardStore(store, (error) => this.fail(error), limits);
    this.tasks = new TaskScheduler(
      this.store,
      definitions,
      maxConcurrentTasks,
      (error) => this.fail(error),
      agents,
      (id) => this.active.has(id),
      (root) => {
        const tasks = this.store.transaction((tx) => tx.taskTree(root));
        for (const task of tasks)
          if (task.agentRunId !== undefined && task.status === "cancelling")
            this.active.get(task.agentRunId)?.controller.abort(new Error("Owner task cancelled."));
        this.pump();
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
    options.store.acquire();
    return new DurableRuntime(
      options.store,
      agents,
      maxConcurrentRuns,
      definitions,
      maxConcurrentTasks,
      limits,
      options.onFatalError,
    );
  }

  /** Validate and add immutable registrations without restarting running work.
   * Existing IDs cannot be replaced. Registration does not retry blocked runs.
   */
  registerAgents(values: readonly DurableAgentRegistration[]): void {
    this.assertOpen();
    const added = registrations(values);
    for (const id of added.keys())
      if (this.agents.has(id)) throw new DurableConflictError(`Agent already registered: ${id}`);
    for (const [id, registration] of added) this.agents.set(id, registration);
  }

  /** Release an idle registration, preserving journal history and outcomes.
   * Re-register compatible code before retrying a failed run or spawning new work.
   */
  unregisterAgent(id: string): boolean {
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
      if (this.store.list({ agentId: id, status, limit: 1 }).runs.length)
        throw new DurableConflictError(`Agent still has unfinished work: ${id}`);
    return this.agents.delete(id);
  }

  /** Submit one persistent objective using a goal definition registered in options.tasks. */
  async submitGoal(
    definition: DefinedGoal,
    input: GoalInput & { sessionId: string; requestId: string },
  ): Promise<DurableTaskHandle<GoalResult>> {
    const { sessionId, requestId, ...goal } = input;
    return this.submitTask(definition, { sessionId, requestId, input: goal });
  }

  async submitTask<I, S, R>(
    definition: DefinedTask<I, S, R>,
    input: { sessionId: string; requestId: string; input: I },
  ): Promise<DurableTaskHandle<R>> {
    this.assertOpen();
    const id = this.tasks.submit(
      definition.name,
      definition.version,
      input.input,
      input.sessionId,
      input.requestId,
    );
    return new DurableTaskHandle<R>(id, this.tasks, this.store, () => this.assertOpen());
  }

  /** Resolve effective agents for authorization without persisting or scheduling a task. */
  taskSubmissionScope(input: TaskSubmission): {
    sessionId: string;
    taskName: string;
    agentIds: string[];
  } {
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
    const id = this.tasks.submit(
      submission.name,
      submission.version,
      submission.input,
      submission.sessionId,
      submission.requestId,
      options.expectedAgentIds,
    );
    return new DurableTaskHandle(id, this.tasks, this.store, () => this.assertOpen());
  }

  /** Owning scope for authorization without loading operation journals or graph results. */
  runScope(runId: string): DurableRunScope {
    this.assertOpen();
    return this.store.transaction((tx) => {
      const run = requireRun(tx, runId);
      const base = { runId, agentId: run.agentId, sessionId: run.sessionId };
      if (run.graphId !== undefined)
        return {
          ...base,
          sessionId: requireGraph(tx, run.graphId).submission.sessionId,
          graphId: run.graphId,
          taskId: run.taskId!,
        };
      if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return base;
      const task = tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
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
    this.tasks.snapshot(id);
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
    const submission = {
      agentId: input.agentId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      prompt: parsePrompt(input.prompt),
    };
    const registration = this.agents.get(input.agentId);
    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${input.agentId}`);
    const id = this.store.transaction((tx) => {
      const existing = tx.findRequest(input.sessionId, input.requestId);
      if (existing !== undefined) {
        if (existing.agentId !== input.agentId || !sameJson(existing.prompt, submission.prompt)) {
          throw new DurableConflictError("requestId already belongs to a different submission.");
        }
        return existing.id;
      }
      if (!options.enqueue && tx.activeRun(input.sessionId) !== undefined)
        throw new DurableConflictError("Session already has unfinished work.");
      if (
        !options.enqueue &&
        [...this.active.values()].some((active) => active.sessionId === input.sessionId)
      ) {
        throw new DurableConflictError("Previous session execution is still settling.");
      }
      const run = createRunRecord(submission, registration);
      tx.putRun(run);
      tx.appendEvent(run.id, "submitted", json(submission));
      return run.id;
    });
    this.pump();
    return new DurableRun(id, this);
  }

  async submitGraph(input: DurableGraphSubmission): Promise<DurableTaskGraph> {
    this.assertOpen();
    const submission = parseDurableGraphSubmission(input);
    const id = this.store.transaction((tx) => createGraph(tx, submission, this.agents));
    this.pump();
    return new DurableTaskGraph(id, this);
  }

  async getGraph(id: string): Promise<DurableTaskGraph> {
    this.graphSnapshot(id);
    return new DurableTaskGraph(id, this);
  }

  async listGraphs(options: DurableGraphListOptions = {}): Promise<DurableGraphPage> {
    this.assertOpen();
    return this.store.listGraphs(graphListSchema.parse(options));
  }

  graphSnapshot(id: string): DurableGraphSnapshot {
    this.assertOpen();
    return this.store.transaction((tx) => graphSnapshot(tx, id));
  }

  graphEvents(id: string, after: number) {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
    return this.store.graphEvents(id, after, 100);
  }

  cancelGraph(id: string): void {
    this.assertOpen();
    const ids = this.store.transaction((tx) => {
      const graph = requireGraph(tx, id);
      if (graph.cancelled || graphSnapshot(tx, id).status === "completed") return [];
      graph.cancelled = true;
      tx.putGraph(graph);
      const runIds = Object.values(graph.runIds);
      for (const runId of runIds) {
        const run = requireRun(tx, runId);
        if (["completed", "failed", "cancelled"].includes(run.status)) continue;
        delete run.nextAttemptAt;
        run.error = "Durable graph cancelled.";
        setStatus(tx, run, "cancelled");
      }
      // Cancellation remains observable even when every task had already failed.
      tx.appendEvent(runIds[0]!, "status", { graphCancelled: true });
      return runIds;
    });
    for (const runId of ids)
      this.active.get(runId)?.controller.abort(new Error("Durable graph cancelled."));
    this.pump();
  }

  async listRuns(options: DurableListOptions = {}): Promise<DurableRunPage> {
    this.assertOpen();
    return this.store.list(listOptionsSchema.parse(options));
  }

  async getRun(id: string): Promise<DurableRun> {
    this.snapshot(id);
    return new DurableRun(id, this);
  }

  /** Discover recoverable work. This does not wait for runs or approvals to finish. */
  async resume(): Promise<void> {
    this.assertOpen();
    this.pump();
    this.tasks.resume();
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
    ]).then(() => {
      try {
        this.store.close();
      } finally {
        this.closed = true;
      }
    });
    return this.closePromise;
  }

  snapshot(id: string): DurableSnapshot {
    this.assertOpen();
    return this.store.transaction((tx) => ({
      run: requireRun(tx, id),
      operations: tx.operations(id),
      cursor: tx.cursor(),
    }));
  }

  events(id: string, after: number) {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid event cursor.");
    return this.store.events(id, after, 100);
  }

  respond(id: string, interactionId: string, value: AgentInteractionResponse): void {
    this.assertOpen();
    nonblank(interactionId, "Interaction ID");
    const response = parseAgentInteractionResponse(value);
    this.store.transaction((tx) => {
      const run = requireRun(tx, id);
      if (run.graphId !== undefined && requireGraph(tx, run.graphId).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (Object.hasOwn(run.responses, interactionId)) {
        if (!sameJson(run.responses[interactionId], response))
          throw new DurableConflictError("Interaction already received a different response.");
        return;
      }
      assertOwnedTaskMutable(tx, run);
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
      setStatus(tx, run, "pending");
    });
    this.pump();
  }

  resolveTool(id: string, operationId: string, output: ToolResultOutput): void {
    this.assertOpen();
    this.store.transaction((tx) => {
      const run = requireRun(tx, id);
      assertOwnedTaskMutable(tx, run);
      if (run.graphId !== undefined && requireGraph(tx, run.graphId).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (run.status !== "needs_attention" || run.blockedOperation !== operationId) {
        throw new DurableConflictError("No matching tool awaiting reconciliation.");
      }
      const operation = tx.getOperation(id, operationId);
      if (operation?.kind !== "tool" || operation.status !== "started")
        throw new DurableConflictError("Operation cannot be reconciled.");
      const checked = parseMessage({
        role: "tool",
        content: [{ type: "tool-result", toolCallId: operationId, toolName: "reconciled", output }],
      });
      if (checked.role !== "tool" || checked.content[0]?.type !== "tool-result")
        throw new TypeError("Invalid tool result.");
      const result = json({ output: checked.content[0].output, failed: false });
      tx.putOperation(id, { ...operation, status: "completed", result });
      tx.appendEvent(id, "tool_completed", { operationId, result, reconciled: true });
      delete run.blockedOperation;
      delete run.error;
      setStatus(tx, run, "pending");
    });
    this.pump();
  }

  retry(id: string): void {
    this.assertOpen();
    if (this.active.has(id)) throw new DurableConflictError("Run is still settling.");
    this.store.transaction((tx) => {
      const run = requireRun(tx, id);
      assertOwnedTaskMutable(tx, run);
      if (run.graphId !== undefined && requireGraph(tx, run.graphId).cancelled)
        throw new DurableConflictError("Graph is cancelled.");
      if (run.status !== "failed" && run.status !== "needs_attention")
        throw new DurableConflictError("Only failed or blocked runs can be retried.");
      const other = tx.activeRun(run.sessionId);
      if (other !== undefined && other.id !== id && other.status !== "queued")
        throw new DurableConflictError("Session already has unfinished work.");
      if (tx.hasLaterStartedRun(id))
        throw new DurableConflictError("Session has advanced; create a new submission.");
      for (const operation of tx.operations(id)) {
        if (
          (operation.kind === "model" ||
            operation.kind === "compaction" ||
            operation.kind === "context") &&
          operation.status === "started"
        )
          tx.putOperation(id, { ...operation, attempts: 0 });
      }
      delete run.error;
      delete run.blockedOperation;
      delete run.exhaustion;
      setStatus(tx, run, "pending");
    });
    this.pump();
  }

  cancel(id: string): void {
    this.assertOpen();
    const sessionId = this.store.transaction((tx) => {
      const run = requireRun(tx, id);
      if (["completed", "failed", "cancelled"].includes(run.status)) return run.sessionId;
      delete run.nextAttemptAt;
      run.error = "Durable run cancelled.";
      setStatus(tx, run, "cancelled");
      return run.sessionId;
    });
    this.active.get(id)?.controller.abort(new Error("Durable run cancelled."));
    if (sessionId.startsWith(TASK_SESSION_PREFIX))
      this.tasks.agentChanged(sessionId.slice(TASK_SESSION_PREFIX.length));
    this.pump();
  }

  private pump(): void {
    if (this.closing || this.failure !== undefined) return;
    clearTimeout(this.wakeTimer);
    const capacity = this.maxConcurrentRuns - this.active.size;
    if (capacity <= 0) return;
    const candidates = this.store.schedule(
      new Date().toISOString(),
      capacity,
      [...this.active.values()].map((active) => active.sessionId),
    );
    for (const id of candidates.ids) this.launch(id);
    if (candidates.nextAttemptAt !== undefined) {
      this.wakeTimer = setTimeout(
        () => {
          try {
            this.pump();
          } catch (error) {
            this.fail(error);
          }
        },
        Math.max(1, Math.min(2_147_483_647, Date.parse(candidates.nextAttemptAt) - Date.now())),
      );
      this.wakeTimer.unref();
    }
  }

  private launch(id: string): void {
    if (this.active.has(id) || this.closing) return;
    const { status, sessionId, agentId } = this.snapshot(id).run;
    if (!["queued", "pending", "running", "retry_wait"].includes(status)) return;
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => this.execute(id, controller.signal))
      .catch((error: unknown) => {
        if (!(error instanceof DurableLimitError)) throw error;
        this.store.transaction((tx) => {
          const run = requireRun(tx, id);
          run.error = error.message;
          setStatus(tx, run, "needs_attention");
        });
      })
      .finally(() => {
        this.active.delete(id);
        if (
          !this.closing &&
          this.failure === undefined &&
          sessionId.startsWith(TASK_SESSION_PREFIX)
        )
          this.tasks.agentChanged(sessionId.slice(TASK_SESSION_PREFIX.length));
        if (!this.closing && this.failure === undefined) this.pump();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        this.fail(error);
      });
    this.active.set(id, { agentId, sessionId, controller, task });
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const run = this.store.transaction((tx) => {
      const current = requireRun(tx, id);
      if (!["queued", "pending", "running", "retry_wait"].includes(current.status))
        return undefined;
      if (current.status === "queued") {
        if (current.graphId !== undefined) {
          current.input = { messages: [promptMessage(graphInput(tx, current))] };
        } else {
          const previous = tx.latestCompleted(current.sessionId);
          current.history =
            previous === undefined
              ? []
              : [...previous.history, ...(previous.outcome?.messages ?? [])];
          if (previous?.contextCheckpoint !== undefined)
            current.contextCheckpoint = previous.contextCheckpoint;
          current.input = {
            messages: [...current.history, promptMessage(current.prompt)],
          };
        }
      }
      current.startedAt ??= new Date().toISOString();
      delete current.nextAttemptAt;
      delete current.error;
      setStatus(tx, current, "running");
      return current;
    });
    if (run === undefined) return;
    if (run.sessionId.startsWith(TASK_SESSION_PREFIX))
      this.tasks.agentChanged(run.sessionId.slice(TASK_SESSION_PREFIX.length));
    try {
      const registration = this.agents.get(run.agentId);
      if (registration === undefined || registration.version !== run.version) {
        throw new DurableRecoveryError(
          "The saved agent version is not registered. Restore it before retrying.",
        );
      }
      await prepareContext(this.store, run, registration, signal);
      const options = withInternalAgentRunOptions(
        {
          ...run.input,
          abortSignal: signal,
          retries: false as const,
        },
        { runId: id, execution: createExecution(this.store, run, registration, signal) },
      );
      const outcome =
        run.stream === true
          ? await registration.agent.stream(options).result
          : await registration.agent.generate(options);
      signal.throwIfAborted();
      this.store.transaction((tx) => {
        const current = requireRun(tx, id);
        current.outcome = { ...outcome, usage: current.usage };
        setStatus(tx, current, outcome.type === "interaction" ? "waiting" : "completed");
      });
    } catch (error) {
      if (error instanceof DurableStorageError) throw error;
      if (signal.aborted) return;
      this.store.transaction((tx) => {
        const current = requireRun(tx, id);
        current.error = errorMessage(error);
        if (error instanceof MaxTurnsError)
          current.exhaustion = { reason: "max_turns", messages: error.chatHistory };
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
          setStatus(tx, current, "retry_wait");
        } else {
          setStatus(
            tx,
            current,
            error instanceof DurableRecoveryError ? "needs_attention" : "failed",
          );
        }
      });
    }
  }

  metrics() {
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

function requireRun(tx: DurableTransaction, id: string): DurableRunRecord {
  const run = tx.getRun(id);
  if (run === undefined) throw new DurableNotFoundError(`Unknown durable run: ${id}`);
  return run;
}

function setStatus(
  tx: DurableTransaction,
  run: DurableRunRecord,
  status: DurableRunRecord["status"],
): void {
  run.status = status;
  run.updatedAt = new Date().toISOString();
  tx.putRun(run);
  tx.appendEvent(
    run.id,
    "status",
    json({
      status,
      error: run.error,
      blockedOperation: run.blockedOperation,
      nextAttemptAt: run.nextAttemptAt,
      outcome: run.outcome,
    }),
  );
}

function assertOwnedTaskMutable(tx: DurableTransaction, run: DurableRunRecord): void {
  if (!run.sessionId.startsWith(TASK_SESSION_PREFIX)) return;
  const task = tx.getTask(run.sessionId.slice(TASK_SESSION_PREFIX.length));
  if (
    task === undefined ||
    ["completing", "cancelling", "completed", "failed", "cancelled"].includes(task.status)
  )
    throw new DurableConflictError(
      "Owned task outcomes are immutable; create a new task submission.",
    );
}
