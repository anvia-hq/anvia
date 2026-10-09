import { createContextPreparation } from "./loop-context.js";
import { MaxTurnsError } from "@anvia/core/agent";
import {
  Usage,
  type CompletionRequest,
  type CompletionResponse,
  type JsonValue,
} from "@anvia/core/completion";
import type {
  AgentCompletionStreamEvent,
  AgentRunExecution,
  AgentToolExecutionResult,
} from "@anvia/core/internal/agent";
import { AgentObserverDispatchError } from "@anvia/core/observability";
import { DurableModelError, DurableRecoveryError, DurableStorageError } from "./errors.js";
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
  const prepare = createContextPreparation(store, run, registration, signal);

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
        ...(operation.attemptId === undefined ? {} : { attemptId: operation.attemptId }),
      });
    });
  }

  function modelOperation(turn: number, request: CompletionRequest): DurableOperation {
    modelPhase = turn;
    return start(
      `${prefix}model:${turn}`,
      "model",
      json({
        provider: registration.agent.model.provider,
        modelId: registration.agent.model.modelId,
        request,
      }),
      "safe",
    );
  }

  function beginAttempt(operation: DurableOperation, streaming = false): void {
    if (run.modelRetry !== undefined && (operation.attempts ?? 0) >= run.modelRetry.maxAttempts) {
      throw new DurableModelError(
        operation.key,
        operation.attempts!,
        new Error("Durable model attempt budget exhausted; retry explicitly to reset it."),
      );
    }
    operation.attempts = (operation.attempts ?? 0) + 1;
    if (streaming) operation.attemptId = globalThis.crypto.randomUUID();
    store.transaction((tx) => {
      tx.putOperation(run.id, operation);
      if (streaming)
        tx.appendEvent(run.id, "model_attempt_started", {
          operationId: operation.key,
          attemptId: operation.attemptId!,
          attempt: operation.attempts!,
        });
    });
  }

  function saveResponse(
    operation: DurableOperation,
    response: CompletionResponse,
  ): CompletionResponse {
    // SDK response objects can contain classes, cycles, or credentials. Persist normalized fields only.
    const { rawResponse: _raw, ...normalized } = response;
    const saved = json({ ...normalized, rawResponse: null });
    complete(operation, saved, response.usage);
    return saved as unknown as CompletionResponse;
  }

  return {
    async prepareMessages(turn, messages, checkpoint) {
      // Check before compaction too: an exhausted session must not spend another model call.
      const exhausted = store.transaction((tx) => {
        const current = tx.getRun(run.id)!;
        return (
          current.modelTurns >= current.maxModelTurns &&
          tx.getOperation(run.id, `${prefix}model:${turn}`) === undefined
        );
      });
      if (exhausted)
        throw new MaxTurnsError(run.maxModelTurns - 1, [...messages], messages.at(-1)!);
      return prepare(turn, messages, checkpoint);
    },
    async completion(turn, request, execute) {
      const operation = modelOperation(turn, request);
      if (operation.status === "completed")
        return operation.result as unknown as CompletionResponse;
      beginAttempt(operation);
      let response: CompletionResponse;
      try {
        response = await execute();
      } catch (error) {
        check();
        if (error instanceof AgentObserverDispatchError) throw error;
        throw new DurableModelError(operation.key, operation.attempts!, error);
      }
      return saveResponse(operation, response);
    },
    async *streamCompletion(turn, request, execute) {
      const operation = modelOperation(turn, request);
      if (operation.status === "completed")
        return operation.result as unknown as CompletionResponse;
      beginAttempt(operation, true);
      const stream: AsyncIterator<AgentCompletionStreamEvent, CompletionResponse> = execute();
      let finished = false;
      let failed = false;
      try {
        while (true) {
          check();
          let next: IteratorResult<AgentCompletionStreamEvent, CompletionResponse>;
          try {
            next = await stream.next();
          } catch (error) {
            check();
            if (error instanceof AgentObserverDispatchError) throw error;
            throw new DurableModelError(operation.key, operation.attempts!, error);
          }
          check();
          if (next.done) {
            finished = true;
            return saveResponse(operation, next.value);
          }
          store.transaction((tx) => {
            if (tx.getRun(run.id)?.status !== "running")
              throw new Error("Durable run is no longer running.");
            tx.appendEvent(
              run.id,
              "model_delta",
              json({
                operationId: operation.key,
                attemptId: operation.attemptId,
                event: next.value,
              }),
            );
          });
          yield next.value;
        }
      } catch (error) {
        failed = true;
        check();
        store.transaction((tx) =>
          tx.appendEvent(run.id, "model_attempt_failed", {
            operationId: operation.key,
            attemptId: operation.attemptId!,
            failureKind: error instanceof DurableModelError ? "model" : "local",
            error: errorMessage(error),
          }),
        );
        throw error;
      } finally {
        if (!finished) await closeCompletionStream(stream, failed);
      }
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
        if (error instanceof DurableStorageError) throw error;
        throw new DurableRecoveryError(
          `Could not record the tool result: ${errorMessage(error)}`,
          key,
        );
      }
    },
  };
}

async function closeCompletionStream(
  stream: AsyncIterator<AgentCompletionStreamEvent, CompletionResponse>,
  failed: boolean,
): Promise<void> {
  try {
    await stream.return?.();
  } catch (error) {
    // Cleanup may fail independently, but must preserve an existing execution failure.
    if (!failed) throw error;
  }
}

function restoreToolResult(value: JsonValue): AgentToolExecutionResult {
  const result = value as unknown as AgentToolExecutionResult;
  return result.failed ? { ...result, error: new Error(String(result.error)) } : result;
}
