import { createSteeringDrain } from "./steering.js";
import { createContextPreparation } from "./loop-context.js";
import { MaxTurnsError } from "@anvia/core/agent";
import {
  Usage,
  type CompletionRequest,
  type CompletionResponse,
  type JsonValue,
  type JsonObject,
  type Document,
  type ToolDefinition,
} from "@anvia/core/completion";
import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type {
  AgentCompletionStreamEvent,
  AgentRunExecution,
  AgentToolExecutionResult,
} from "@anvia/core/internal/agent";
import { AgentObserverDispatchError } from "@anvia/core/observability";
import { DurableModelError, DurableRecoveryError, DurableStorageError } from "./errors.js";
import {
  externalizeContextDocsResult,
  externalizeModelInput,
  externalizeModelResult,
  externalizeToolResult,
  hydrateValue,
} from "./blob.js";
import { errorMessage, json, sameJson } from "./json.js";
import type {
  DurableAgentRegistration,
  DurableOperation,
  DurableRunRecord,
  DurableStore,
  DurableTransaction,
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
  const toolKey = (toolCallId: string) =>
    `${prefix}tool:${modelPhase === 0 ? "resume" : modelPhase}:${toolCallId}`;

  async function start(
    key: string,
    kind: DurableOperation["kind"],
    input: JsonValue,
    recovery: DurableOperation["recovery"],
  ): Promise<DurableOperation> {
    check();
    return store.transaction(async (tx) => {
      // The journal stores a bounded form; content addressing makes it deterministic, so the
      // replay comparison below can run on stored forms directly.
      const stored =
        kind === "model" ? await tx.blobs((io) => externalizeModelInput(io, input)) : input;
      const previous = await tx.getOperation(run.id, key);
      if (previous !== undefined) {
        // Compare restored forms: a journal written before blob references stores the input
        // inline, and the same input now externalizes differently. Both restore to `input`.
        if (
          !sameJson(await tx.blobs((io) => hydrateValue(io, previous.input)), input) ||
          previous.kind !== kind
        ) {
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
        // Restored results are handed back to the agent loop fully hydrated.
        return previous.status === "completed"
          ? { ...previous, result: await tx.blobs((io) => hydrateValue(io, previous.result!)) }
          : previous;
      }
      const current = (await tx.getRun(run.id))!;
      if (kind === "model") {
        // Core's maxTurns counts tool-loop continuations in addition to the initial response.
        if (current.modelTurns >= current.maxModelTurns) {
          throw new Error("Durable run exhausted its model-turn budget.");
        }
        current.modelTurns += 1;
        await tx.putRun(current);
      }
      const operation: DurableOperation = { key, kind, input: stored, recovery, status: "started" };
      await tx.putOperation(run.id, operation);
      await tx.appendEvent(run.id, kind === "model" ? "model_started" : "tool_started", {
        operationId: key,
        input: stored,
      });
      return operation;
    });
  }

  async function complete(
    operation: DurableOperation,
    result: JsonValue,
    usage?: Usage,
  ): Promise<void> {
    check();
    await store.transaction(async (tx) => {
      const current = (await tx.getRun(run.id))!;
      if (current.status !== "running") throw new Error("Durable run is no longer running.");
      // Oversized results move to the blob table here, atomically with the referencing write.
      const stored =
        operation.kind === "tool"
          ? await tx.blobs((io) => externalizeToolResult(io, result))
          : operation.kind === "model"
            ? await tx.blobs((io) => externalizeModelResult(io, result))
            : result;
      await tx.putOperation(run.id, { ...operation, status: "completed", result: stored });
      if (usage !== undefined) {
        current.usage = Usage.add(current.usage, usage);
        await tx.putRun(current);
      }

      const data: JsonObject = {
        operationId: operation.key,
        result: stored,
      };

      if (operation.attemptId !== undefined) {
        data.attemptId = operation.attemptId;
      }

      await tx.appendEvent(
        run.id,
        operation.kind === "model" ? "model_completed" : "tool_completed",
        data,
      );
    });
  }

  async function modelOperation(
    turn: number,
    request: CompletionRequest,
  ): Promise<DurableOperation> {
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

  async function beginAttempt(operation: DurableOperation, streaming = false): Promise<void> {
    if (run.modelRetry !== undefined && (operation.attempts ?? 0) >= run.modelRetry.maxAttempts) {
      throw new DurableModelError(
        operation.key,
        operation.attempts!,
        new Error("Durable model attempt budget exhausted; retry explicitly to reset it."),
      );
    }
    operation.attempts = (operation.attempts ?? 0) + 1;
    if (streaming) operation.attemptId = globalThis.crypto.randomUUID();
    await store.transaction(async (tx) => {
      await tx.putOperation(run.id, operation);
      if (streaming)
        await tx.appendEvent(run.id, "model_attempt_started", {
          operationId: operation.key,
          attemptId: operation.attemptId!,
          attempt: operation.attempts!,
        });
    });
  }

  async function saveResponse(
    operation: DurableOperation,
    response: CompletionResponse,
  ): Promise<CompletionResponse> {
    // SDK response objects can contain classes, cycles, or credentials. Persist normalized fields only.
    const { rawResponse: _raw, ...normalized } = response;
    const saved = json({ ...normalized, rawResponse: null });
    await complete(operation, saved, response.usage);
    return saved as unknown as CompletionResponse;
  }

  const execution: AgentRunExecution = {
    // Status only: tool args are not final yet, and a changed input fails in start() with a
    // recovery error that the run's own span records.
    async replayed(step) {
      const key =
        step.kind === "tool"
          ? toolKey(step.toolCall.toolCallId)
          : `${prefix}${step.kind}:${step.turn}`;
      return (
        (await store.transaction(async (tx) => tx.getOperation(run.id, key)))?.status ===
        "completed"
      );
    },
    async prepareMessages(turn, messages, checkpoint) {
      // Check before compaction too: an exhausted session must not spend another model call.
      const exhausted = await store.transaction(async (tx) => {
        const current = (await tx.getRun(run.id))!;
        return (
          current.modelTurns >= current.maxModelTurns &&
          (await tx.getOperation(run.id, `${prefix}model:${turn}`)) === undefined
        );
      });
      if (exhausted)
        throw new MaxTurnsError(run.maxModelTurns - 1, [...messages], messages.at(-1)!);
      return prepare(turn, messages, checkpoint);
    },
    async completion(turn, request, execute) {
      const operation = await modelOperation(turn, request);
      if (operation.status === "completed")
        return operation.result as unknown as CompletionResponse;
      await beginAttempt(operation);
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
      const operation = await modelOperation(turn, request);
      if (operation.status === "completed")
        return operation.result as unknown as CompletionResponse;
      await beginAttempt(operation, true);
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
          await store.transaction(async (tx) => {
            if ((await tx.getRun(run.id))?.status !== "running")
              throw new Error("Durable run is no longer running.");
            await tx.appendEvent(
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
        await store.transaction(async (tx) =>
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
      const key = toolKey(call.toolCall.toolCallId);
      const operation = await start(
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
        await complete(operation, saved);
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

  if (run.steering !== undefined) {
    execution.drainSteering = createSteeringDrain(store, run, signal);
  }

  // Tool-index search is a read of an external index: its selection is recorded once, before the
  // model call that uses it, so a replayed turn offers the same tools without searching again.
  if (
    registration.toolIndexes !== undefined &&
    (getResolvedAgentOptions(registration.agent).toolIndexes?.length ?? 0) > 0
  ) {
    execution.selectTools = async (turn, select) => {
      const key = `${prefix}tools:${turn}`;
      const recorded = (operation: DurableOperation | undefined) =>
        (operation!.result as unknown as { tools: ToolDefinition[] }).tools;
      const previous = await store.transaction(async (tx) => tx.getOperation(run.id, key));
      if (previous?.status === "completed") return recorded(previous);
      check();
      const selected = await select();
      check();
      return store.transaction(async (tx) => {
        const current = await tx.getOperation(run.id, key);
        if (current?.status === "completed") return recorded(current);
        if ((await tx.getRun(run.id))?.status !== "running")
          throw new Error("Durable run is no longer running.");
        // Stored in JSON form, so the first run and every replay hand the agent the same value.
        const operation: DurableOperation = {
          key,
          kind: "effect",
          input: json({ turn }),
          status: "completed",
          recovery: "manual",
          result: json({ tools: selected }),
        };
        await tx.putOperation(run.id, operation);
        return recorded(operation);
      });
    };
  }

  // Vector retrieval reads an external store: each context's documents are recorded once, before the
  // model call that uses them, so a replayed turn sees the same documents without querying again.
  if (registration.context !== undefined) {
    execution.selectContext = async (turn, index, retrieve) => {
      const key = `${prefix}context-docs:${turn}:${index}`;
      const recorded = async (
        tx: DurableTransaction,
        operation: DurableOperation | undefined,
      ): Promise<Document[]> =>
        (
          (await tx.blobs((io) => hydrateValue(io, operation!.result!))) as unknown as {
            documents: Document[];
          }
        ).documents;
      const previous = await store.transaction(async (tx) => {
        const operation = await tx.getOperation(run.id, key);
        return operation?.status === "completed"
          ? { ...operation, result: await tx.blobs((io) => hydrateValue(io, operation.result!)) }
          : operation;
      });
      if (previous?.status === "completed")
        return (previous.result as unknown as { documents: Document[] }).documents;
      check();
      const retrieved = await retrieve();
      check();
      return store.transaction(async (tx) => {
        const current = await tx.getOperation(run.id, key);
        if (current?.status === "completed") return recorded(tx, current);
        if ((await tx.getRun(run.id))?.status !== "running")
          throw new Error("Durable run is no longer running.");
        const operation: DurableOperation = {
          key,
          kind: "effect",
          input: json({ turn, index }),
          status: "completed",
          recovery: "manual",
          // An oversized document set moves to the blob table here, like an oversized tool result,
          // so one retrieval cannot exceed the operation payload limit.
          result: await tx.blobs((io) =>
            externalizeContextDocsResult(io, json({ documents: retrieved })),
          ),
        };
        await tx.putOperation(run.id, operation);
        return recorded(tx, operation);
      });
    };
  }

  return execution;
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
