import type { JsonValue } from "@anvia/core/completion";
import {
  DurableConflictError,
  DurableRecoveryError,
  DurableStorageError,
  DurableLimitError,
  DurableNotFoundError,
} from "../errors.js";
import { errorMessage, json, sameJson } from "../json.js";
import type { DurableStore, DurableAgentRegistration, DurableTraceOptions } from "../types.js";
import { taskWaitSchema } from "./schema.js";
import { taskInvocation } from "./invocation.js";
import { spawnAgent } from "./agent.js";
import type { DurableMcpServers } from "../mcp-servers.js";
import type { DurableToolIndexes } from "../tool-indexes.js";
import {
  cancelTree,
  createTask,
  prepareTask,
  reconcileTree,
  requireTask,
  saveTask,
  taskKey,
  terminal,
} from "./state.js";
import type { RegisteredTask, TaskGraphSnapshot, TaskRecord, TaskTransition } from "./types.js";

function dependencies(definition: RegisteredTask, task: TaskRecord): string[] {
  return [...new Set(definition.agentDependencies?.(task.input, task.checkpoint) ?? [])].sort();
}

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
    private readonly mcpServers: ReadonlyMap<string, DurableMcpServers>,
    private readonly toolIndexes: ReadonlyMap<string, DurableToolIndexes>,
    private readonly agentActive: (id: string) => boolean,
    private readonly syncAgents: (root: string) => Promise<void>,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  async agentChanged(id: string): Promise<void> {
    if (this.closing) return;
    await this.reconcile((await this.snapshot(id)).task.rootId);
    await this.pump();
  }

  async submissionScope(
    name: string,
    version: number,
    input: unknown,
    sessionId: string,
    key: string,
  ) {
    const definition = this.definition(name, version);
    return this.store.transaction(async (tx) => {
      const { task } = await prepareTask(tx, definition, input, sessionId, key);
      return {
        sessionId: task.sessionId,
        taskName: task.name,
        agentIds: dependencies(definition, task),
      };
    });
  }

  async submit(
    name: string,
    version: number,
    input: unknown,
    sessionId: string,
    key: string,
    expectedAgentIds?: readonly string[],
    trace?: DurableTraceOptions,
  ): Promise<string> {
    const definition = this.definition(name, version);
    const task = await this.store.transaction(async (tx) => {
      const task = await createTask(tx, definition, input, sessionId, key, undefined, trace);
      const agentIds = dependencies(definition, task);
      if (
        expectedAgentIds !== undefined &&
        !sameJson(agentIds, [...new Set(expectedAgentIds)].sort())
      )
        throw new DurableConflictError(
          "Task agents changed during authorization; retry submission.",
        );
      for (const agentId of agentIds)
        if (!this.agents.has(agentId))
          throw new DurableNotFoundError(`Unknown durable agent: ${agentId}`);
      return task;
    });
    await this.pump();
    return task.id;
  }

  private definition(name: string, version: number): RegisteredTask {
    const definition = this.definitions.get(name);
    if (definition === undefined || definition.version !== version)
      throw new DurableConflictError(`Task definition/version is not registered: ${name}`);
    return definition;
  }

  async resume(): Promise<void> {
    let cursor: number | undefined = 0;
    while (cursor !== undefined) {
      const page = await this.store.unsettledTaskRoots(cursor);
      for (const root of page.ids) await this.reconcile(root);
      cursor = page.cursor;
    }
    await this.pump();
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

  async snapshot(id: string, options: { operations?: boolean } = {}) {
    return this.store.transaction(async (tx) => ({
      task: await requireTask(tx, id),
      operations: options.operations === true ? await tx.operations(id) : [],
      cursor: await tx.cursor(),
    }));
  }

  async graph(id: string): Promise<TaskGraphSnapshot> {
    return this.store.transaction(async (tx) => {
      const rootId = (await requireTask(tx, id)).rootId;
      const nodes = await tx.taskTree(rootId);
      const edges: TaskGraphSnapshot["edges"] = [];
      for (const task of nodes) {
        if (task.parentId !== undefined)
          edges.push({ source: task.parentId, target: task.id, type: "owns" });
        if (task.wait?.type === "children")
          for (const child of task.wait.ids)
            edges.push({ source: task.id, target: child, type: "waits" });
      }
      return { rootId, nodes, edges, cursor: await tx.cursor() };
    });
  }

  async cancel(id: string, expectedTreeIds?: readonly string[]): Promise<void> {
    const root = (await this.snapshot(id)).task.rootId;
    const ids = await this.store.transaction(async (tx) => {
      if (expectedTreeIds !== undefined) {
        const current = await tx.taskTree(root);
        const expected = new Set(expectedTreeIds);
        if (current.length !== expected.size || current.some((task) => !expected.has(task.id)))
          throw new DurableConflictError(
            "Task tree changed during authorization; retry cancellation.",
          );
      }
      return cancelTree(tx, id, "Durable task cancelled.");
    });
    for (const task of ids)
      this.active.get(task)?.controller.abort(new Error("Durable task cancelled."));
    await this.reconcile(root);
    await this.pump();
  }

  async signal(id: string, name: string, requestId: string, value: JsonValue): Promise<void> {
    taskKey(name);
    taskKey(requestId);
    const root = await this.store.transaction(async (tx) => {
      const task = await requireTask(tx, id);
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
      await saveTask(tx, task);
      return task.rootId;
    });
    await this.reconcile(root);
    await this.pump();
  }

  async retry(id: string): Promise<void> {
    if (this.active.has(id)) throw new DurableConflictError("Task invocation is still settling.");
    await this.store.transaction(async (tx) => {
      const task = await requireTask(tx, id);
      if (task.status !== "needs_attention")
        throw new DurableConflictError(
          "Only tasks needing attention can resume; terminal outcomes are immutable.",
        );
      delete task.error;
      delete task.blockedOperation;
      task.status = "pending";
      await saveTask(tx, task);
    });
    await this.pump();
  }

  async resolveEffect(id: string, key: string, value: JsonValue): Promise<void> {
    if (this.active.has(id)) throw new DurableConflictError("Task invocation is still settling.");
    await this.store.transaction(async (tx) => {
      const task = await requireTask(tx, id);
      const operation = await tx.getOperation(id, key);
      if (
        task.status !== "needs_attention" ||
        task.blockedOperation !== key ||
        operation?.status !== "started" ||
        operation.kind !== "effect"
      )
        throw new DurableConflictError("No matching effect awaiting reconciliation.");
      await tx.putOperation(id, { ...operation, status: "completed", result: json(value) });
      task.status = "pending";
      delete task.blockedOperation;
      delete task.error;
      await saveTask(tx, task);
    });
    await this.pump();
  }

  private async reconcile(root: string): Promise<void> {
    // A fail-fast pass may mark earlier children cancelling; the second pass settles idle ones.
    for (let pass = 0; pass < 2; pass++) {
      const result = await this.store.transaction(async (tx) =>
        reconcileTree(tx, root, new Set(this.active.keys()), this.agentActive),
      );
      for (const id of result.abort)
        this.active.get(id)?.controller.abort(new Error("Sibling task failed."));
      if (result.deadline === undefined) this.deadlines.delete(root);
      else this.deadlines.set(root, result.deadline);
    }
    await this.syncAgents(root);
  }

  /** Pumps run one at a time: scheduling reads the store, so overlapping pumps could launch one task twice. */
  private pump(): Promise<void> {
    const next = this.pumpTail.then(() => this.pumpOnce());
    this.pumpTail = next.catch(() => undefined);
    return next;
  }

  private pumpTail: Promise<void> = Promise.resolve();

  private async pumpOnce(): Promise<void> {
    if (this.closing) return;
    clearTimeout(this.timer);
    for (const [root, deadline] of this.deadlines)
      if (deadline <= Date.now()) await this.reconcile(root);
    const capacity = this.capacity - this.active.size;
    if (capacity > 0)
      for (const id of await this.store.scheduleTasks([...this.active.keys()], capacity))
        if (!this.active.has(id)) this.launch(id);
    if (this.deadlines.size > 0) {
      const deadline = Math.min(...this.deadlines.values());
      this.timer = setTimeout(
        async () => {
          try {
            await this.pump();
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
      .catch(async (error: unknown) => {
        if (!(error instanceof DurableLimitError)) throw error;
        await this.store.transaction(async (tx) => {
          const task = await requireTask(tx, id);
          delete task.wait;
          delete task.outcome;
          task.status = "needs_attention";
          task.error = error.message;
          await saveTask(tx, task);
        });
      })
      .finally(async () => {
        this.active.delete(id);
        if (!this.closing) {
          await this.reconcile((await this.snapshot(id)).task.rootId);
          await this.pump();
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
    const task = await this.store.transaction(async (tx) => {
      const saved = await requireTask(tx, id);
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
      await saveTask(tx, saved);
      return saved;
    });
    if (task?.status !== "running") return;
    const definition = this.definitions.get(task.name)!;
    const invocation = taskInvocation(
      this.store,
      task,
      this.definitions,
      controller,
      async () => {
        await this.syncAgents(task.rootId);
        await this.pump();
      },
      async (tx, parent, key, input) =>
        spawnAgent(tx, this.agents, this.mcpServers, this.toolIndexes, parent, key, input),
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
    if (failure instanceof DurableStorageError) throw failure;
    if (this.closing) return;
    const abort = await this.store.transaction(async (tx) => {
      const current = await requireTask(tx, id);
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
            if (wait.type === "children") {
              let direct = new Set(wait.ids).size === wait.ids.length;
              for (const child of wait.ids)
                if ((await requireTask(tx, child)).parentId !== id) direct = false;
              if (!direct) throw new TypeError("Tasks may wait only on distinct direct children.");
            }
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
            current.outcome = { status: transition.status, error: errorMessage(transition.error) };
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
        if (error instanceof DurableRecoveryError || error instanceof DurableLimitError) {
          current.status = "needs_attention";
          if (error instanceof DurableRecoveryError && error.operationId !== undefined)
            current.blockedOperation = error.operationId;
        } else {
          current.status = "cancelling";
          current.outcome = { status: "failed", error: current.error };
          cancelChildren = true;
        }
      }
      const ids = cancelChildren
        ? await (async () => {
            const aborted: string[] = [];
            for (const child of await tx.taskChildren(id))
              aborted.push(
                ...(await cancelTree(tx, child.id, "Owner task failed or was cancelled.")),
              );
            return aborted;
          })()
        : [];
      await saveTask(tx, current);
      return ids;
    });
    for (const child of abort)
      this.active.get(child)?.controller.abort(new Error("Owner task ended."));
  }
}
