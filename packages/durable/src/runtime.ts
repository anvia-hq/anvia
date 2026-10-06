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
} from "./errors.js";
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
} from "./types.js";

export class DurableRuntime {
  private readonly agents: Map<string, DurableAgentRegistration>;
  private readonly active = new Map<
    string,
    { sessionId: string; controller: AbortController; task: Promise<void> }
  >();
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private failure: unknown;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly tasks: TaskScheduler;

  private constructor(
    private readonly store: DurableStore,
    agents: Map<string, DurableAgentRegistration>,
    private readonly maxConcurrentRuns: number,
    definitions: ReadonlyMap<string, RegisteredTask>,
    maxConcurrentTasks: number,
  ) {
    this.agents = agents;
    this.tasks = new TaskScheduler(
      store,
      definitions,
      maxConcurrentTasks,
      (error) => {
        this.failure = error;
        for (const active of this.active.values()) active.controller.abort(error);
      },
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
    options.store.acquire();
    return new DurableRuntime(
      options.store,
      agents,
      maxConcurrentRuns,
      definitions,
      maxConcurrentTasks,
    );
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

  async getTask(id: string): Promise<DurableTaskHandle> {
    this.assertOpen();
    this.tasks.snapshot(id);
    return new DurableTaskHandle(id, this.tasks, this.store, () => this.assertOpen());
  }

  async listTasks(options: TaskListOptions = {}) {
    this.assertOpen();
    return this.store.listTasks(options);
  }

  async taskGraph(id: string) {
    this.assertOpen();
    return this.tasks.graph(id);
  }

  async submit(input: DurableSubmission, options: DurableSubmitOptions = {}): Promise<DurableRun> {
    this.assertOpen();
    if (options.enqueue !== undefined && typeof options.enqueue !== "boolean")
      throw new TypeError("enqueue must be a boolean.");
    for (const key of ["agentId", "sessionId", "requestId", "prompt"] as const)
      nonblank(input[key], key);
    if (
      input.sessionId.startsWith(GRAPH_SESSION_PREFIX) ||
      input.sessionId.startsWith(TASK_SESSION_PREFIX)
    )
      throw new TypeError("Reserved durable session ID.");
    const submission = {
      agentId: input.agentId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      prompt: input.prompt,
    };
    const registration = this.agents.get(input.agentId);
    if (registration === undefined)
      throw new DurableNotFoundError(`Unknown durable agent: ${input.agentId}`);
    const id = this.store.transaction((tx) => {
      const existing = tx.findRequest(input.sessionId, input.requestId);
      if (existing !== undefined) {
        if (existing.agentId !== input.agentId || existing.prompt !== input.prompt) {
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
    ]).then(() => this.store.close());
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
        if (operation.kind === "model" && operation.status === "started")
          tx.putOperation(id, { ...operation, attempts: 0 });
      }
      delete run.error;
      delete run.blockedOperation;
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
            this.failure = error;
            this.tasks.stop(error);
            for (const active of this.active.values()) active.controller.abort(error);
          }
        },
        Math.max(1, Math.min(2_147_483_647, Date.parse(candidates.nextAttemptAt) - Date.now())),
      );
      this.wakeTimer.unref();
    }
  }

  private launch(id: string): void {
    if (this.active.has(id) || this.closing) return;
    const { status, sessionId } = this.snapshot(id).run;
    if (!["queued", "pending", "running", "retry_wait"].includes(status)) return;
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => this.execute(id, controller.signal))
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
        this.failure = error;
        this.tasks.stop(error);
        for (const active of this.active.values()) active.controller.abort(error);
      });
    this.active.set(id, { sessionId, controller, task });
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const run = this.store.transaction((tx) => {
      const current = requireRun(tx, id);
      if (!["queued", "pending", "running", "retry_wait"].includes(current.status))
        return undefined;
      if (current.status === "queued") {
        if (current.graphId !== undefined) {
          current.input = { messages: [{ role: "user", content: graphInput(tx, current) }] };
        } else {
          const previous = tx.latestCompleted(current.sessionId);
          current.history =
            previous === undefined
              ? []
              : [...previous.history, ...(previous.outcome?.messages ?? [])];
          current.input = {
            messages: [...current.history, { role: "user", content: current.prompt }],
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
      const outcome = await registration.agent.generate(
        withInternalAgentRunOptions(
          {
            ...run.input,
            abortSignal: signal,
            retries: false,
          },
          { runId: id, execution: createExecution(this.store, run, registration, signal) },
        ),
      );
      signal.throwIfAborted();
      this.store.transaction((tx) => {
        const current = requireRun(tx, id);
        current.outcome = { ...outcome, usage: current.usage };
        setStatus(tx, current, outcome.type === "interaction" ? "waiting" : "completed");
      });
    } catch (error) {
      if (signal.aborted) return;
      this.store.transaction((tx) => {
        const current = requireRun(tx, id);
        current.error = errorMessage(error);
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

  private assertOpen(): void {
    if (this.closing) throw new Error("Durable runtime is closed.");
    if (this.failure !== undefined)
      throw new Error("Durable runtime storage failed; close and reopen it.", {
        cause: this.failure,
      });
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
