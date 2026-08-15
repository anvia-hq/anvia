import type { Agent } from "../../agent/agent";
import type { AgentMemory } from "../../agent/types";
import { type Message as MessageType, Usage } from "../../completion/index";
import {
  createMemoryCompactionSummary,
  cumulativeCompactedMessageCount,
} from "../../memory/compaction";
import { MemoryCompactionConflictError, MemoryCompactionError } from "../../memory/errors";
import type { MemoryCompactionInfo, MemorySavePolicy, MemoryScope } from "../../memory/types";
import { throwIfAborted } from "../abort";

export type MemoryPreparation = {
  history: MessageType[];
  usage: ReturnType<typeof Usage.empty>;
  compaction?: MemoryCompactionInfo | undefined;
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
    incomingMessageCount: number,
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
      incomingMessageCount,
      abortSignal,
    );
    const memoryHistory = preparation.history;
    const chatHistory = [...memoryHistory, ...this.initialHistory];
    return {
      ...preparation,
      history: chatHistory,
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
    incomingMessageCount: number,
    abortSignal?: AbortSignal | undefined,
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
      const compactedMessageCount = compactedPrefixLength(
        snapshot.messages,
        incomingMessageCount,
        options.trigger.afterMessages,
        options.retention.recentUserTurns,
      );
      if (compactedMessageCount === 0) {
        return { history: snapshot.messages, usage };
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
        const retained = snapshot.messages.slice(compactedMessageCount);
        return {
          history: [summary, ...retained],
          usage,
          compaction: {
            originalMessageCount: snapshot.messages.length,
            compactedMessageCount,
            retainedMessageCount: retained.length,
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

function compactedPrefixLength(
  messages: MessageType[],
  incomingMessageCount: number,
  afterMessages: number,
  recentUserTurns: number,
): number {
  if (messages.length + incomingMessageCount <= afterMessages) {
    return 0;
  }
  const userMessageIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  // Keep the recent user-led tail intact. If there are not enough user messages to retain a
  // complete tail, skip compaction even when the transcript already exceeds the trigger threshold.
  if (userMessageIndexes.length <= recentUserTurns) {
    return 0;
  }
  return userMessageIndexes[userMessageIndexes.length - recentUserTurns] ?? 0;
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
