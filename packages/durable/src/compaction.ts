import { Usage, type Message } from "@anvia/core/completion";
import { estimateMemoryTokens, type MemoryCompactionInfo } from "@anvia/core/memory";
import { DurableModelError, DurableRecoveryError } from "./errors.js";
import { hydrateMessages } from "./blob.js";
import { json, sameJson } from "./json.js";
import { promptMessage } from "./prompt.js";
import { contextCheckpointSchema } from "./schema.js";
import type {
  DurableAgentRegistration,
  DurableContextCheckpoint,
  DurableOperation,
  DurableRunRecord,
  DurableStore,
} from "./types.js";

function summaryMessage(checkpoint: DurableContextCheckpoint): Message {
  return {
    role: "system",
    content: checkpoint.summary,
    metadata: {
      anvia: {
        memoryCompaction: { version: 1, compactedMessageCount: checkpoint.compactedMessageCount },
      },
    },
  };
}

function projection(run: DurableRunRecord): Message[] {
  const checkpoint = run.contextCheckpoint;
  return checkpoint === undefined
    ? [...run.history]
    : [summaryMessage(checkpoint), ...run.history.slice(checkpoint.compactedMessageCount)];
}

/** One preparation per submission. Approval continuations and replay use the saved input. */
export async function prepareContext(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
  signal: AbortSignal,
): Promise<void> {
  if (run.compaction === undefined || run.contextPrepared === true || run.graphId !== undefined)
    return;
  if (run.epoch !== 0 || !("messages" in run.input))
    throw new DurableRecoveryError("Compaction requires an unprepared initial run.");
  const options = registration.compaction;
  if (options === undefined)
    throw new DurableRecoveryError("Restore the saved agent's compaction implementation.");
  const counter = options.tokenCounter ?? estimateMemoryTokens;
  const count = async (messages: readonly Message[]) => {
    const value = await counter(structuredClone(messages));
    signal.throwIfAborted();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("Compaction token counter must return a nonnegative safe integer.");
    return value;
  };
  const history = projection(run);
  // Counting and summarizing see restored content; the journal keeps the bounded stored form.
  const expanded = await store.transaction(
    async (tx) => await tx.blobs((io) => hydrateMessages(io, history)),
  );
  const prompt = promptMessage(run.prompt);
  const originalTokenCount = await count(expanded);
  const inputTokens = await count([...expanded, prompt]);
  const keep = run.compaction.retention?.recentTurns ?? 1;
  const starts = history.flatMap((message, index) => (message.role === "user" ? [index] : []));
  const end = keep === 0 ? history.length : (starts[Math.max(0, starts.length - keep)] ?? 0);
  // Do not repeatedly summarize a checkpoint with no new canonical messages.
  const previousCount = run.contextCheckpoint?.compactedMessageCount ?? 0;
  const covered = previousCount + end - (run.contextCheckpoint === undefined ? 0 : 1);
  if (inputTokens <= run.compaction.trigger.afterTokens || end === 0 || covered <= previousCount) {
    await commit(history);
    return;
  }
  const prefix = history.slice(0, end);
  const tail = history.slice(end);
  const retainedTokenCount = await count(expanded.slice(end));
  const compactedTokenCount = await count(expanded.slice(0, end));
  const input = json({ policy: run.compaction, messages: prefix, compactedMessageCount: covered });
  const operation = await store.transaction(async (tx): Promise<DurableOperation> => {
    const saved = await tx.getOperation(run.id, "compaction");
    if (saved !== undefined) {
      if (saved.kind !== "compaction" || !sameJson(saved.input, input))
        throw new DurableRecoveryError("Compaction changed at a saved checkpoint.", "compaction");
      return saved;
    }
    const started: DurableOperation = {
      key: "compaction",
      kind: "compaction",
      recovery: "safe",
      status: "started",
      input,
    };
    await tx.putOperation(run.id, started);
    await tx.appendEvent(run.id, "compaction_started", { operationId: started.key });
    return started;
  });
  // Completion, projected input, usage, and contextPrepared are committed together below.
  if (operation.status === "completed")
    throw new DurableRecoveryError(
      "Completed compaction is missing its prepared context.",
      operation.key,
    );
  if (run.modelRetry !== undefined && (operation.attempts ?? 0) >= run.modelRetry.maxAttempts)
    throw new DurableModelError(
      operation.key,
      operation.attempts!,
      new Error("Compaction attempt budget exhausted."),
    );
  operation.attempts = (operation.attempts ?? 0) + 1;
  await store.transaction(async (tx) => tx.putOperation(run.id, operation));
  let checkpoint: DurableContextCheckpoint;
  let usage: Usage;
  try {
    const result = await options.compactor({
      scope: { sessionId: run.sessionId },
      messages: structuredClone(expanded.slice(0, end)),
      abortSignal: signal,
    });
    signal.throwIfAborted();
    checkpoint = contextCheckpointSchema.parse({
      summary: result.summary,
      compactedMessageCount: covered,
    });
    usage = result.usage ?? Usage.empty();
    // Reject invalid usage before attempting any journal write.
    for (const value of [
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      usage.cachedInputTokens,
      usage.cacheCreationInputTokens,
    ])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError("Invalid compaction usage.");
    if (
      usage.details !== undefined &&
      Object.values(usage.details).some((value) => !Number.isFinite(value))
    )
      throw new TypeError("Invalid compaction usage details.");
    json(usage);
  } catch (error) {
    signal.throwIfAborted();
    throw new DurableModelError(operation.key, operation.attempts, error);
  }
  const messages = [summaryMessage(checkpoint), ...tail];
  const info: MemoryCompactionInfo = {
    originalMessageCount: history.length,
    compactedMessageCount: prefix.length,
    retainedMessageCount: tail.length,
    originalTokenCount,
    compactedTokenCount,
    retainedTokenCount,
    resultTokenCount: await count(messages),
    attempts: operation.attempts,
    usage,
  };
  await commit(messages, { checkpoint, operation, info });

  async function commit(
    messages: Message[],
    result?: {
      checkpoint: DurableContextCheckpoint;
      operation: DurableOperation;
      info: MemoryCompactionInfo;
    },
  ) {
    signal.throwIfAborted();
    const saved = await store.transaction(async (tx) => {
      const current = (await tx.getRun(run.id))!;
      if (current.status !== "running") throw new Error("Durable run is no longer running.");
      current.input = { messages: [...messages, prompt] };
      current.contextPrepared = true;
      if (result !== undefined) {
        current.contextCheckpoint = result.checkpoint;
        current.usage = Usage.add(current.usage, result.info.usage);
        await tx.putOperation(run.id, {
          ...result.operation,
          status: "completed",
          result: json(result.checkpoint),
        });
        await tx.appendEvent(
          run.id,
          "compaction_completed",
          json({ operationId: result.operation.key, ...result.info }),
        );
      }
      await tx.putRun(current);
      return current;
    });
    Object.assign(run, saved);
  }
}
