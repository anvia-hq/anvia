import { Usage, type Message } from "@anvia/core/completion";
import {
  finishLoopContext,
  planLoopContext,
  projectLoopContext,
  summarizeLoopContext,
  type LoopContextCheckpoint,
  type PreparedLoopContext,
} from "@anvia/core/internal/agent";
import { DurableModelError, DurableRecoveryError } from "./errors.js";
import { json, sameJson } from "./json.js";
import { preparedLoopContextSchema } from "./schema.js";
import type {
  DurableAgentRegistration,
  DurableOperation,
  DurableRunRecord,
  DurableStore,
} from "./types.js";

/** Replayed in model-call order; each epoch has its own unchanged source transcript. */
export function createContextPreparation(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
  signal: AbortSignal,
) {
  return async (
    turn: number,
    messages: readonly Message[],
    checkpoint?: LoopContextCheckpoint,
  ): Promise<PreparedLoopContext> => {
    if (run.loopCompaction !== true || run.compaction === undefined || run.graphId !== undefined)
      return { messages: [...messages] };
    signal.throwIfAborted();
    const key = `${run.epoch}:context:${turn}`;
    const input = json(messages);
    let operation = store.transaction((tx) => tx.getOperation(run.id, key));
    if (operation !== undefined) {
      if (operation.kind !== "context" || !sameJson(operation.input, input))
        throw new DurableRecoveryError("Context changed at a saved checkpoint.", key);
      if (operation.status === "completed") {
        const prepared = preparedLoopContextSchema.parse(operation.result);
        return prepared;
      }
    }
    const options = registration.compaction;
    if (options === undefined)
      throw new DurableRecoveryError("Restore the saved agent's compaction implementation.");
    // Histories can contain a long previous run, and approval epochs can start with a
    // newly completed exchange. Both need the same check as subsequent model calls.
    const plan = !messages.some((message) => message.role === "tool")
      ? undefined
      : await planLoopContext(
          messages,
          checkpoint,
          {
            afterTokens: run.compaction.trigger.afterTokens,
            recentToolTurns: run.compaction.retention?.recentToolTurns,
            tokenCounter: options.tokenCounter,
          },
          signal,
        );
    let prepared: PreparedLoopContext;
    if (plan === undefined) {
      prepared = {
        messages: projectLoopContext(messages, checkpoint),
        ...(checkpoint === undefined ? {} : { checkpoint }),
      };
    } else {
      if (operation === undefined) {
        operation = { key, kind: "context", recovery: "safe", status: "started", input };
        store.transaction((tx) => {
          tx.putOperation(run.id, operation!);
          tx.appendEvent(run.id, "compaction_started", {
            operationId: key,
            turn,
            epoch: run.epoch,
          });
        });
      }
      if (run.modelRetry !== undefined && (operation.attempts ?? 0) >= run.modelRetry.maxAttempts)
        throw new DurableModelError(
          key,
          operation.attempts!,
          new Error("Compaction attempt budget exhausted."),
        );
      operation.attempts = (operation.attempts ?? 0) + 1;
      store.transaction((tx) => tx.putOperation(run.id, operation!));
      let summary;
      try {
        summary = await summarizeLoopContext(
          plan,
          options.compactor,
          { sessionId: run.sessionId },
          signal,
        );
        json(summary);
      } catch (error) {
        signal.throwIfAborted();
        throw new DurableModelError(key, operation.attempts, error);
      }
      // Counter and journal failures are local failures, not retryable provider failures.
      prepared = await finishLoopContext(
        plan,
        summary,
        options.tokenCounter,
        signal,
        operation.attempts,
      );
    }
    signal.throwIfAborted();
    const completed: DurableOperation = {
      ...operation,
      key,
      kind: "context",
      recovery: "safe",
      status: "completed",
      input,
      result: json(prepared),
    };
    store.transaction((tx) => {
      const current = tx.getRun(run.id)!;
      if (current.status !== "running") throw new Error("Durable run is no longer running.");
      tx.putOperation(run.id, completed);
      if (prepared.compaction !== undefined) {
        current.usage = Usage.add(current.usage, prepared.compaction.usage);
        tx.putRun(current);
        tx.appendEvent(
          run.id,
          "compaction_completed",
          json({ operationId: key, turn, epoch: run.epoch, ...prepared.compaction }),
        );
      }
    });
    return prepared;
  };
}
