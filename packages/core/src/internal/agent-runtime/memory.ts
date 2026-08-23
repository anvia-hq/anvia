import type { Agent } from "../../agent/agent";
import type { AgentMemory } from "../../agent/types";
import { type Message as MessageType, Usage } from "../../completion/index";
import {
  createMemoryCompactionSummary,
  cumulativeCompactedMessageCount,
} from "../../memory/compaction";
import { MemoryCompactionConflictError, MemoryCompactionError } from "../../memory/errors";
import type {
  MemoryCompactionInfo,
  MemoryCompactionResult,
  MemorySavePolicy,
  MemoryScope,
  MemoryTokenCounter,
} from "../../memory/types";
import { throwIfAborted } from "../abort";

export type MemoryPreparation = {
  history: MessageType[];
  usage: ReturnType<typeof Usage.empty>;
  compaction?: MemoryCompactionInfo | undefined;
  originalTokenCount?: number | undefined;
};

type MemoryAgent = Pick<Agent, "memory">;

export class AgentRunMemory {
  constructor(
    private readonly agent: MemoryAgent,
    private readonly memoryScope: MemoryScope | undefined,
    private readonly initialHistory: MessageType[],
  ) {}

  memoryPolicy(): MemorySavePolicy | undefined {
    return this.memory()?.savePolicy;
  }

  pendingTurnMessages(newMessages: MessageType[]): MessageType[] {
    return this.memoryPolicy() === "turn" ? [...newMessages] : [];
  }

  async prepareHistory(
    runId: string,
    incomingMessages: readonly MessageType[],
    abortSignal?: AbortSignal | undefined,
  ): Promise<MemoryPreparation> {
    const memory = this.memory();
    if (memory === undefined || this.memoryScope === undefined) {
      return {
        history: this.initialHistory,
        usage: Usage.empty(),
      };
    }

    const preparation = await this.prepareStoredHistory(
      memory,
      runId,
      incomingMessages,
      abortSignal,
    );
    const memoryHistory = preparation.history;
    const chatHistory = [...memoryHistory, ...this.initialHistory];
    return {
      ...preparation,
      history: chatHistory,
    };
  }

  async compact(
    runId: string,
    abortSignal?: AbortSignal | undefined,
  ): Promise<MemoryCompactionResult> {
    const memory = this.memory();
    const scope = this.memoryScope;
    if (memory === undefined || scope === undefined) {
      throw new TypeError("Manual memory compaction requires an Agent with configured memory.");
    }
    if (memory.compaction === undefined || memory.store.compaction === undefined) {
      throw new TypeError("Manual memory compaction requires a configured compaction policy.");
    }
    const preparation = await this.prepareStoredHistory(memory, runId, [], abortSignal, true);
    if (preparation.compaction !== undefined) {
      return { type: "compacted", ...preparation.compaction };
    }
    return {
      type: "skipped",
      reason: "nothing_to_compact",
      originalMessageCount: preparation.history.length,
      originalTokenCount:
        preparation.originalTokenCount ??
        (await countTokens(memory.compaction.tokenCounter, preparation.history)),
    };
  }

  async commitAcceptedInput(runId: string, messages: MessageType[]): Promise<void> {
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryScope === undefined ||
      memory.savePolicy !== "message" ||
      messages.length === 0
    ) {
      return;
    }

    await memory.store.append({
      scope: this.memoryScope,
      runId,
      turn: 1,
      messages,
    });
  }

  async commitMessages(
    runId: string,
    turn: number,
    messages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryScope === undefined || messages.length === 0) {
      return;
    }
    if (memory.savePolicy === "message") {
      await memory.store.append({
        scope: this.memoryScope,
        runId,
        turn,
        messages,
      });
    } else if (memory.savePolicy === "turn") {
      pendingTurnMessages.push(...messages);
    }
  }

  async commitCompletedTurn(
    runId: string,
    turn: number,
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryScope === undefined ||
      memory.savePolicy !== "turn" ||
      pendingTurnMessages.length === 0
    ) {
      return;
    }
    await memory.store.append({
      scope: this.memoryScope,
      runId,
      turn,
      messages: [...pendingTurnMessages],
    });
    pendingTurnMessages.length = 0;
  }

  async commitCompletedRun(
    runId: string,
    turn: number,
    newMessages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    await this.commitCompletedTurn(runId, turn, pendingTurnMessages);
    const memory = this.memory();
    if (memory === undefined || this.memoryScope === undefined || memory.savePolicy !== "run") {
      return;
    }
    await memory.store.append({
      scope: this.memoryScope,
      runId,
      turn,
      messages: [...newMessages],
    });
  }

  async recordError(runId: string, error: unknown, newMessages: MessageType[]): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryScope === undefined) {
      return;
    }
    await memory.store.recordError?.({
      scope: this.memoryScope,
      runId,
      error,
      messages: [...newMessages],
    });
  }

  private memory(): AgentMemory | undefined {
    return this.memoryScope === undefined ? undefined : this.agent.memory;
  }

  private async prepareStoredHistory(
    memory: AgentMemory,
    runId: string,
    incomingMessages: readonly MessageType[],
    abortSignal?: AbortSignal | undefined,
    force = false,
  ): Promise<MemoryPreparation> {
    const scope = this.memoryScope;
    if (scope === undefined) {
      return { history: [], usage: Usage.empty() };
    }
    const options = memory.compaction;
    const capability = memory.store.compaction;
    if (options === undefined || capability === undefined) {
      return {
        history: await memory.store.load({ scope }),
        usage: Usage.empty(),
      };
    }

    let usage = Usage.empty();
    const maxAttempts = options.conflictRetries === false ? 1 : options.conflictRetries.maxAttempts;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(abortSignal);
      const snapshot = await capability.snapshot({ scope });
      throwIfAborted(abortSignal);
      const selection = await selectCompactionPrefix(
        snapshot.messages,
        incomingMessages,
        options.trigger.afterTokens,
        options.retention.recentTokens,
        options.tokenCounter,
        force,
      );
      throwIfAborted(abortSignal);
      const compactedMessageCount = selection.compactedMessageCount;
      if (compactedMessageCount === 0) {
        return {
          history: snapshot.messages,
          usage,
          originalTokenCount: selection.originalTokenCount,
        };
      }

      const prefix = snapshot.messages.slice(0, compactedMessageCount);
      let result: Awaited<ReturnType<typeof options.compactor>>;
      try {
        result = await options.compactor({
          scope,
          messages: prefix,
          abortSignal,
        });
      } catch (error) {
        throw remappedCompactorError(error, usage);
      }
      if (result.usage !== undefined) {
        usage = Usage.add(usage, result.usage);
      }
      if (typeof result?.summary !== "string") {
        throw new MemoryCompactionError("Memory compactor must return a summary string.", {
          usage,
        });
      }
      const summaryText = result.summary.trim();
      if (summaryText.length === 0) {
        throw new MemoryCompactionError("Memory compactor returned an empty summary.", {
          usage,
        });
      }
      const summary = createMemoryCompactionSummary(
        summaryText,
        cumulativeCompactedMessageCount(prefix),
      );
      const retained = snapshot.messages.slice(compactedMessageCount);
      let resultTokenCount: number;
      try {
        resultTokenCount = await countTokens(options.tokenCounter, [summary, ...retained]);
      } catch (error) {
        throw remappedCompactorError(error, usage);
      }
      throwIfAborted(abortSignal);
      let replacement: Awaited<ReturnType<typeof capability.replacePrefix>>;
      try {
        replacement = await capability.replacePrefix({
          scope,
          revision: snapshot.revision,
          messageCount: compactedMessageCount,
          replacement: summary,
          runId: `memory-compaction:${runId}:${attempt}`,
        });
      } catch (error) {
        throw new MemoryCompactionError("Memory compaction prefix replacement failed.", {
          cause: error,
          usage,
        });
      }
      if (replacement.status === "committed") {
        return {
          history: [summary, ...retained],
          usage,
          compaction: {
            originalMessageCount: snapshot.messages.length,
            compactedMessageCount,
            retainedMessageCount: retained.length,
            originalTokenCount: selection.originalTokenCount,
            compactedTokenCount: selection.compactedTokenCount,
            retainedTokenCount: selection.retainedTokenCount,
            resultTokenCount,
            attempts: attempt,
            usage,
          },
        };
      }
      throwIfAborted(abortSignal);
    }

    throw new MemoryCompactionConflictError(maxAttempts, usage);
  }
}

type CompactionSelection = {
  compactedMessageCount: number;
  originalTokenCount: number;
  compactedTokenCount: number;
  retainedTokenCount: number;
};

async function selectCompactionPrefix(
  messages: readonly MessageType[],
  incomingMessages: readonly MessageType[],
  afterTokens: number,
  recentTokens: number,
  tokenCounter: MemoryTokenCounter,
  force: boolean,
): Promise<CompactionSelection> {
  const originalTokenCount = await countTokens(tokenCounter, messages);
  const incomingTokenCount =
    incomingMessages.length === 0 ? 0 : await countTokens(tokenCounter, incomingMessages);
  const none = {
    compactedMessageCount: 0,
    originalTokenCount,
    compactedTokenCount: 0,
    retainedTokenCount: originalTokenCount,
  };
  if (!force && originalTokenCount + incomingTokenCount <= afterTokens) {
    return none;
  }
  const userMessageIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  if (userMessageIndexes.length <= 1) {
    return none;
  }

  // Retain complete user-led turns. The newest turn is always kept even when it alone exceeds the
  // retention budget. Find the earliest newer turn whose tail fits with logarithmic counter calls.
  const tailTokenCounts = new Map<number, number>();
  const countTail = async (messageIndex: number): Promise<number> => {
    const cached = tailTokenCounts.get(messageIndex);
    if (cached !== undefined) return cached;
    const count = await countTokens(tokenCounter, messages.slice(messageIndex));
    tailTokenCounts.set(messageIndex, count);
    return count;
  };
  let lower = 0;
  let upper = userMessageIndexes.length - 1;
  let retainedBoundary = upper;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = userMessageIndexes[middle] ?? 0;
    if ((await countTail(candidate)) <= recentTokens) {
      retainedBoundary = middle;
      upper = middle - 1;
    } else {
      lower = middle + 1;
    }
  }
  const compactedMessageCount = userMessageIndexes[retainedBoundary] ?? 0;
  if (compactedMessageCount === 0) {
    return none;
  }
  const compactedTokenCount = await countTokens(
    tokenCounter,
    messages.slice(0, compactedMessageCount),
  );
  const retainedTokenCount =
    tailTokenCounts.get(compactedMessageCount) ??
    (await countTokens(tokenCounter, messages.slice(compactedMessageCount)));
  return {
    compactedMessageCount,
    originalTokenCount,
    compactedTokenCount,
    retainedTokenCount,
  };
}

async function countTokens(
  tokenCounter: MemoryTokenCounter,
  messages: readonly MessageType[],
): Promise<number> {
  let count: number;
  try {
    count = await tokenCounter(messages);
  } catch (error) {
    throw new MemoryCompactionError("Memory token counter failed.", { cause: error });
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new MemoryCompactionError("Memory token counter must return a nonnegative safe integer.");
  }
  return count;
}

function remappedCompactorError(error: unknown, usage: ReturnType<typeof Usage.empty>): Error {
  if (error instanceof MemoryCompactionError) {
    const mergedUsage =
      error.usage === undefined
        ? usage
        : isEmptyUsage(usage)
          ? error.usage
          : Usage.add(usage, error.usage);
    if (mergedUsage === error.usage || (error.usage === undefined && isEmptyUsage(usage))) {
      return error;
    }
    return new MemoryCompactionError(error.message, {
      cause: error,
      usage: mergedUsage,
    });
  }
  return new MemoryCompactionError("Memory compactor failed.", {
    cause: error,
    usage,
  });
}

function isEmptyUsage(usage: ReturnType<typeof Usage.empty>): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.totalTokens === 0 &&
    usage.cachedInputTokens === 0 &&
    usage.cacheCreationInputTokens === 0
  );
}
