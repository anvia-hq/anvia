import type { JsonValue } from "@anvia/core/completion";
import { DurableConflictError, DurableRecoveryError } from "../errors.js";
import { errorMessage, json, sameJson } from "../json.js";
import type { DurableStore, DurableAgentRegistration } from "../types.js";
import { taskWaitSchema } from "./schema.js";
import { taskInvocation, TaskPersistenceError } from "./invocation.js";
import { spawnAgent } from "./agent.js";
import {
  cancelTree,
  createTask,
  reconcileTree,
  requireTask,
  saveTask,
  taskKey,
  terminal,
} from "./state.js";
import type { RegisteredTask, TaskGraphSnapshot, TaskTransition } from "./types.js";

/** Owns phase invocations only; DurableRuntime owns the shared database lifecycle. */
export class TaskScheduler {
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly deadlines = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closing = false;

  constructor(
    private readonly store: DurableStore,
    private readonly definitions: ReadonlyMap<string, RegisteredTask>,
    private readonly capacity: number,
    private readonly fatal: (error: unknown) => void,
    private readonly agents: ReadonlyMap<string, DurableAgentRegistration>,
    private readonly agentActive: (id: string) => boolean,
    private readonly syncAgents: (root: string) => void,
  ) {}

  agentChanged(id: string): void {
    if (this.closing) return;
    this.reconcile(this.snapshot(id).task.rootId);
    this.pump();
  }

  submit(name: string, version: number, input: unknown, sessionId: string, key: string): string {
    const definition = this.definitions.get(name);
    if (definition === undefined || definition.version !== version)
      throw new DurableRecoveryError(`Task definition is not registered: ${name}`);
    const task = this.store.transaction((tx) => createTask(tx, definition, input, sessionId, key));
    this.pump();
    return task.id;
  }

  resume(): void {
    let cursor: number | undefined = 0;
    while (cursor !== undefined) {
      const page = this.store.unsettledTaskRoots(cursor);
      for (const root of page.ids) this.reconcile(root);
      cursor = page.cursor;
    }
    this.pump();
  }

  stop(reason: unknown): void {
    this.closing = true;
    clearTimeout(this.timer);
    for (const invocation of this.active.values()) invocation.controller.abort(reason);
  }

  async close(): Promise<void> {
    this.stop(new Error("Durable runtime closed."));
    await Promise.all([...this.active.values()].map((value) => value.promise));
  }

  snapshot(id: string) {
    return this.store.transaction((tx) => ({
      task: requireTask(tx, id),
      operations: tx.operations(id),
      cursor: tx.cursor(),
    }));
  }

  graph(id: string): TaskGraphSnapshot {
    return this.store.transaction((tx) => {
      const rootId = requireTask(tx, id).rootId;
      const nodes = tx.taskTree(rootId);
      const edges: TaskGraphSnapshot["edges"] = [];
      for (const task of nodes) {
        if (task.parentId !== undefined)
          edges.push({ source: task.parentId, target: task.id, type: "owns" });
        if (task.wait?.type === "children")
          for (const child of task.wait.ids)
            edges.push({ source: task.id, target: child, type: "waits" });
      }
      return { rootId, nodes, edges, cursor: tx.cursor() };
    });
  }

  cancel(id: string): void {
    const root = this.snapshot(id).task.rootId;
    const ids = this.store.transaction((tx) => cancelTree(tx, id, "Durable task cancelled."));
    for (const task of ids)
      this.active.get(task)?.controller.abort(new Error("Durable task cancelled."));
    this.reconcile(root);
    this.pump();
  }

  signal(id: string, name: string, requestId: string, value: JsonValue): void {
    taskKey(name);
    taskKey(requestId);
    const root = this.store.transaction((tx) => {
      const task = requireTask(tx, id);
      if (Object.hasOwn(task.signals, name)) {
        if (!sameJson(task.signals[name], { requestId, value: json(value) }))
          throw new DurableConflictError("Signal already has a different delivery.");
        return task.rootId;
      }
      if (terminal(task) || ["completing", "cancelling"].includes(task.status))
        throw new DurableConflictError("Task cannot receive a signal.");
      if (Object.keys(task.signals).length >= 1000)
        throw new DurableConflictError("Task signal limit reached.");
      Object.defineProperty(task.signals, name, {
        value: { requestId, value: json(value) },
        enumerable: true,
      });
      saveTask(tx, task);
      return task.rootId;
    });
    this.reconcile(root);
    this.pump();
  }

  retry(id: string): void {
    if (this.active.has(id)) throw new DurableConflictError("Task invocation is still settling.");
    this.store.transaction((tx) => {
      const task = requireTask(tx, id);
      if (task.status !== "needs_attention")
        throw new DurableConflictError(
          "Only tasks needing attention can resume; terminal outcomes are immutable.",
        );
      delete task.error;
      delete task.blockedOperation;
      task.status = "pending";
      saveTask(tx, task);
    });
    this.pump();
  }

  resolveEffect(id: string, key: string, value: JsonValue): void {
    if (this.active.has(id)) throw new DurableConflictError("Task invocation is still settling.");
    this.store.transaction((tx) => {
      const task = requireTask(tx, id);
      const operation = tx.getOperation(id, key);
      if (
        task.status !== "needs_attention" ||
        task.blockedOperation !== key ||
        operation?.status !== "started" ||
        operation.kind !== "effect"
      )
        throw new DurableConflictError("No matching effect awaiting reconciliation.");
      tx.putOperation(id, { ...operation, status: "completed", result: json(value) });
      task.status = "pending";
      delete task.blockedOperation;
      delete task.error;
      saveTask(tx, task);
    });
    this.pump();
  }

  private reconcile(root: string): void {
    // A fail-fast pass may mark earlier children cancelling; the second pass settles idle ones.
    for (let pass = 0; pass < 2; pass++) {
      const result = this.store.transaction((tx) =>
        reconcileTree(tx, root, new Set(this.active.keys()), this.agentActive),
      );
      for (const id of result.abort)
        this.active.get(id)?.controller.abort(new Error("Sibling task failed."));
      if (result.deadline === undefined) this.deadlines.delete(root);
      else this.deadlines.set(root, result.deadline);
    }
    this.syncAgents(root);
  }

  private pump(): void {
    if (this.closing) return;
    clearTimeout(this.timer);
    for (const [root, deadline] of this.deadlines) if (deadline <= Date.now()) this.reconcile(root);
    const capacity = this.capacity - this.active.size;
    if (capacity > 0)
      for (const id of this.store.scheduleTasks([...this.active.keys()], capacity)) this.launch(id);
    if (this.deadlines.size > 0) {
      const deadline = Math.min(...this.deadlines.values());
      this.timer = setTimeout(
        () => {
          try {
            this.pump();
          } catch (error) {
            this.stop(error);
            this.fatal(error);
          }
        },
        Math.max(1, Math.min(2_147_483_647, deadline - Date.now())),
      );
      this.timer.unref();
    }
  }

  private launch(id: string): void {
    const controller = new AbortController();
    const promise = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.execute(id, controller))
      .finally(() => {
        this.active.delete(id);
        if (!this.closing) {
          this.reconcile(this.snapshot(id).task.rootId);
          this.pump();
        }
      })
      .catch((error: unknown) => {
        this.stop(error);
        this.fatal(error);
      });
    this.active.set(id, { controller, promise });
  }

  private async execute(id: string, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    const task = this.store.transaction((tx) => {
      const saved = requireTask(tx, id);
      if (!["pending", "running"].includes(saved.status)) return undefined;
      const definition = this.definitions.get(saved.name);
      try {
        if (definition === undefined || definition.version < saved.version)
          throw new Error("Task definition/version is unavailable.");
        if (definition.version !== saved.version) {
          if (definition.migrate === undefined)
            throw new Error("Task checkpoint requires a migration.");
          const migrated = definition.migrate(saved.input, saved.checkpoint, saved.version);
          saved.input = migrated.input;
          saved.checkpoint = migrated.checkpoint;
          saved.version = definition.version;
        }
        saved.input = definition.parseInput(saved.input);
        saved.checkpoint = definition.parseCheckpoint(saved.checkpoint);
        saved.status = "running";
        delete saved.error;
      } catch (error) {
        saved.status = "needs_attention";
        saved.error = errorMessage(error);
      }
      saveTask(tx, saved);
      return saved;
    });
    if (task?.status !== "running") return;
    const definition = this.definitions.get(task.name)!;
    const invocation = taskInvocation(
      this.store,
      task,
      this.definitions,
      controller,
      () => {
        this.syncAgents(task.rootId);
        this.pump();
      },
      (tx, parent, key, input) => spawnAgent(tx, this.agents, parent, key, input),
    );
    let transition: TaskTransition<JsonValue, JsonValue> | undefined;
    let failure: unknown;
    try {
      transition = await definition.run(invocation.context);
    } catch (error) {
      failure = error;
    }
    try {
      await invocation.finish();
    } catch (error) {
      failure = error;
    }
    if (failure instanceof TaskPersistenceError) throw failure;
    if (this.closing) return;
    const abort = this.store.transaction((tx) => {
      const current = requireTask(tx, id);
      if (current.status !== "running") return [];
      let cancelChildren = false;
      try {
        if (failure !== undefined) throw failure;
        if (transition === undefined) throw new TypeError("Task must return a transition.");
        switch (transition.status) {
          case "pending":
            current.checkpoint = definition.parseCheckpoint(transition.checkpoint);
            current.status = "pending";
            break;
          case "waiting": {
            const wait = taskWaitSchema.parse(transition.wait);
            if (wait.type === "agent")
              throw new TypeError("Agent waits are managed by spawnAgent().");
            if (
              wait.type === "children" &&
              (new Set(wait.ids).size !== wait.ids.length ||
                wait.ids.some((child) => requireTask(tx, child).parentId !== id))
            )
              throw new TypeError("Tasks may wait only on distinct direct children.");
            current.checkpoint = definition.parseCheckpoint(transition.checkpoint);
            current.wait = wait;
            current.status = "waiting";
            break;
          }
          case "completed":
            current.outcome = {
              status: "completed",
              output: definition.parseOutput(transition.output),
            };
            current.status = "completing";
            break;
          case "failed":
          case "cancelled":
            current.outcome = { status: transition.status, error: String(transition.error) };
            current.status = "cancelling";
            cancelChildren = true;
            break;
          default:
            throw new TypeError("Invalid task transition.");
        }
      } catch (error) {
        delete current.wait;
        delete current.outcome;
        current.error = errorMessage(error);
        if (error instanceof DurableRecoveryError) {
          current.status = "needs_attention";
          if (error.operationId !== undefined) current.blockedOperation = error.operationId;
        } else {
          current.status = "cancelling";
          current.outcome = { status: "failed", error: current.error };
          cancelChildren = true;
        }
      }
      const ids = cancelChildren
        ? tx
            .taskChildren(id)
            .flatMap((child) => cancelTree(tx, child.id, "Owner task failed or was cancelled."))
        : [];
      saveTask(tx, current);
      return ids;
    });
    for (const child of abort)
      this.active.get(child)?.controller.abort(new Error("Owner task ended."));
  }
}
