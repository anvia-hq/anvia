import { Usage, type CompletionResponse, type JsonValue } from "@anvia/core/completion";
import type { AgentRunExecution, AgentToolExecutionResult } from "@anvia/core/internal/agent";
import { DurableModelError, DurableRecoveryError } from "./errors.js";
import { errorMessage, json, sameJson } from "./json.js";
import type {
  DurableAgentRegistration,
  DurableOperation,
  DurableRunRecord,
  DurableStore,
} from "./types.js";

/** Reconstruct the agent loop from committed operation results, never repeating completed effects. */
export function createExecution(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
  signal: AbortSignal,
): AgentRunExecution {
  const prefix = `${run.epoch}:`;
  let modelPhase = 0;
  const check = () => signal.throwIfAborted();

  function start(
    key: string,
    kind: DurableOperation["kind"],
    input: JsonValue,
    recovery: DurableOperation["recovery"],
  ): DurableOperation {
    check();
    return store.transaction((tx) => {
      const previous = tx.getOperation(run.id, key);
      if (previous !== undefined) {
        if (!sameJson(previous.input, input) || previous.kind !== kind) {
          throw new DurableRecoveryError(
            "Execution changed at a saved checkpoint; restore the registered agent version.",
            key,
          );
        }
        if (previous.status === "started" && previous.recovery === "manual") {
          throw new DurableRecoveryError(
            "An interrupted tool has an uncertain outcome and requires reconciliation.",
            key,
          );
        }
        return previous;
      }
      const current = tx.getRun(run.id)!;
      if (kind === "model") {
        // Core's maxTurns counts tool-loop continuations in addition to the initial response.
        if (current.modelTurns >= current.maxModelTurns) {
          throw new Error("Durable run exhausted its model-turn budget.");
        }
        current.modelTurns += 1;
        tx.putRun(current);
      }
      const operation: DurableOperation = { key, kind, input, recovery, status: "started" };
      tx.putOperation(run.id, operation);
      tx.appendEvent(run.id, kind === "model" ? "model_started" : "tool_started", {
        operationId: key,
        input,
      });
      return operation;
    });
  }

  function complete(operation: DurableOperation, result: JsonValue, usage?: Usage): void {
    check();
    store.transaction((tx) => {
      const current = tx.getRun(run.id)!;
      if (current.status !== "running") throw new Error("Durable run is no longer running.");
      tx.putOperation(run.id, { ...operation, status: "completed", result });
      if (usage !== undefined) {
        current.usage = Usage.add(current.usage, usage);
        tx.putRun(current);
      }
      tx.appendEvent(run.id, operation.kind === "model" ? "model_completed" : "tool_completed", {
        operationId: operation.key,
        result,
      });
    });
  }

  return {
    async completion(turn, request, execute) {
      modelPhase = turn;
      const operation = start(
        `${prefix}model:${turn}`,
        "model",
        json({
          provider: registration.agent.model.provider,
          modelId: registration.agent.model.modelId,
          request,
        }),
        "safe",
      );
      if (operation.status === "completed")
        return operation.result as unknown as CompletionResponse;
      if (run.modelRetry !== undefined && (operation.attempts ?? 0) >= run.modelRetry.maxAttempts) {
        throw new DurableModelError(
          operation.key,
          operation.attempts!,
          new Error("Durable model attempt budget exhausted; retry explicitly to reset it."),
        );
      }
      const attempts = (operation.attempts ?? 0) + 1;
      operation.attempts = attempts;
      store.transaction((tx) => tx.putOperation(run.id, operation));
      let response: CompletionResponse;
      try {
        response = await execute();
      } catch (error) {
        check();
        throw new DurableModelError(operation.key, attempts, error);
      }
      // SDK response objects can contain classes, cycles, or credentials. Persist normalized fields only.
      const { rawResponse: _raw, ...normalized } = response;
      const saved = json({ ...normalized, rawResponse: null });
      complete(operation, saved, response.usage);
      return saved as unknown as CompletionResponse;
    },
    async tool(call, execute) {
      const key = `${prefix}tool:${modelPhase === 0 ? "resume" : modelPhase}:${call.toolCall.toolCallId}`;
      const operation = start(
        key,
        "tool",
        json(call),
        registration.toolRecovery?.[call.toolCall.toolName] ?? "manual",
      );
      if (operation.status === "completed") return restoreToolResult(operation.result!);
      const result = await execute({ operationId: `${run.id}/${key}` });
      check();
      try {
        const saved = json(
          result.failed
            ? { output: result.output, failed: true, error: errorMessage(result.error) }
            : result,
        );
        complete(operation, saved);
        return restoreToolResult(saved);
      } catch (error) {
        throw new DurableRecoveryError(
          `Could not record the tool result: ${errorMessage(error)}`,
          key,
        );
      }
    },
  };
}

function restoreToolResult(value: JsonValue): AgentToolExecutionResult {
  const result = value as unknown as AgentToolExecutionResult;
  return result.failed ? { ...result, error: new Error(String(result.error)) } : result;
}
