import type { JsonValue } from "@anvia/core/completion";
import {
  DurableConflictError,
  DurableRecoveryError,
  DurableStorageError,
  DurableLimitError,
} from "../errors.js";
import { hydrateValue } from "../blob.js";
import { json, sameJson } from "../json.js";
import type { DurableRunRecord, DurableStore, DurableTransaction, ToolRecovery } from "../types.js";
import { createTask, requireTask, taskKey } from "./state.js";
import type { RegisteredTask, TaskAgentInput, TaskContext, TaskRecord } from "./types.js";

export function taskInvocation(
  store: DurableStore,
  task: TaskRecord,
  definitions: ReadonlyMap<string, RegisteredTask>,
  controller: AbortController,
  changed: () => void,
  spawnAgent: (
    tx: DurableTransaction,
    parent: TaskRecord,
    key: string,
    input: TaskAgentInput,
  ) => Promise<string>,
) {
  let open = true;
  let fatal: unknown;
  const transaction = async <T>(callback: (tx: DurableTransaction) => Promise<T>): Promise<T> => {
    try {
      return await store.transaction(callback);
    } catch (error) {
      if (error instanceof DurableStorageError) fatal = error;
      throw error;
    }
  };
  const effects = new Set<Promise<JsonValue>>();
  const keys = new Set<string>();
  const assertActive = async () => {
    if (fatal !== undefined) throw fatal;
    controller.signal.throwIfAborted();
    if (!open) throw new DurableConflictError("Task invocation has finished.");
    await transaction(async (tx) => {
      if ((await requireTask(tx, task.id)).status !== "running")
        throw new DurableConflictError("Task is no longer running.");
    });
  };
  const effect = async <T extends JsonValue>(
    key: string,
    input: JsonValue,
    execute: (operationId: string, signal: AbortSignal) => Promise<T>,
    recovery: ToolRecovery = "manual",
  ): Promise<T> => {
    await assertActive();
    taskKey(key);
    if (!["manual", "safe", "idempotent"].includes(recovery))
      throw new TypeError("Invalid effect recovery policy.");
    if (keys.has(key))
      throw new DurableConflictError("Concurrent use of one effect key is not allowed.");
    keys.add(key);
    try {
      const saved = await transaction(async (tx) => {
        const existing = await tx.getOperation(task.id, key);
        if (existing !== undefined) {
          if (!sameJson(existing.input, input) || existing.recovery !== recovery)
            throw new DurableRecoveryError("Effect input or recovery policy changed.", key);
          return existing;
        }
        const operation = {
          key,
          kind: "effect" as const,
          input: json(input),
          status: "started" as const,
          recovery,
        };
        await tx.putOperation(task.id, operation);
        return undefined;
      });
      if (saved?.status === "completed") return json(saved.result) as T;
      if (saved?.recovery === "manual")
        throw new DurableRecoveryError("Effect requires external reconciliation.", key);
      const output = await execute(`${task.id}/${key}`, controller.signal);
      let result: JsonValue;
      try {
        result = json(output);
      } catch {
        throw new DurableRecoveryError(
          "Effect returned non-JSON output; reconcile its external result.",
          key,
        );
      }
      await assertActive();
      try {
        await transaction(async (tx) => {
          const operation = (await tx.getOperation(task.id, key))!;
          await tx.putOperation(task.id, { ...operation, status: "completed", result });
        });
      } catch (error) {
        if (error instanceof DurableLimitError)
          throw new DurableRecoveryError(
            "Effect result exceeds the payload limit; reconcile its external result.",
            key,
          );
        throw error;
      }
      return result as T;
    } catch (error) {
      if (error instanceof DurableRecoveryError) fatal ??= error;
      throw error;
    } finally {
      keys.delete(key);
    }
  };
  const context: TaskContext<JsonValue, JsonValue> = {
    id: task.id,
    input: json(task.input),
    checkpoint: json(task.checkpoint),
    signal: controller.signal,
    spawn: async (key, definition, input) => {
      await assertActive();
      const registered = definitions.get(definition.name);
      if (registered === undefined || registered.version !== definition.version)
        throw new DurableRecoveryError(`Task definition is not registered: ${definition.name}`);
      const child = await transaction(async (tx) =>
        createTask(tx, registered, input, task.sessionId, key, task.id),
      );
      changed();
      return child.id;
    },
    spawnAgent: async (key, input) => {
      await assertActive();
      const id = await transaction((tx) => spawnAgent(tx, task, key, input));
      changed();
      return id;
    },
    children: async () => {
      await assertActive();
      return transaction(async (tx) => tx.taskChildren(task.id));
    },
    agentRun: async (childId) => {
      await assertActive();
      return transaction(async (tx) => {
        const child = await requireTask(tx, childId);
        if (child.parentId !== task.id || child.agentRunId === undefined)
          throw new DurableConflictError("Expected a direct owned agent child.");
        const run = await tx.getRun(child.agentRunId);
        if (run === undefined) throw new DurableRecoveryError("Owned agent run is missing.");
        // Goal rounds read outcomes and transcripts from this record, so restore any references.
        return (await tx.blobs((io) => hydrateValue(io, json(run)))) as DurableRunRecord;
      });
    },
    signalValue: async (name) => {
      await assertActive();
      const signals = await transaction(async (tx) => (await requireTask(tx, task.id)).signals);
      return Object.hasOwn(signals, name) ? json(signals[name]!.value) : undefined;
    },
    effect: (key, input, execute, recovery) => {
      const pending = effect(key, input, execute, recovery);
      effects.add(pending);
      void pending.then(
        () => effects.delete(pending),
        () => effects.delete(pending),
      );
      return pending;
    },
  };
  return {
    context,
    async finish() {
      open = false;
      if (effects.size > 0) {
        controller.abort(new Error("Task returned before its effects settled."));
        await Promise.allSettled(effects);
        if (fatal !== undefined) throw fatal;
        throw new Error("Task returned before its effects settled.");
      }
      if (fatal !== undefined) throw fatal;
    },
  };
}
