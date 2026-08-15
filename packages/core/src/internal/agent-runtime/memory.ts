import type { Agent } from "../../agent/agent";
import { type Message as MessageType, Usage } from "../../completion/index";
import {
  createMemoryCompactionSummary,
  cumulativeCompactedMessageCount,
} from "../../memory/compaction";
import { MemoryCompactionConflictError, MemoryCompactionError } from "../../memory/errors";
import type { MemoryContext, MemoryRegistration, MemorySavePolicy } from "../../memory/types";

export type MemoryPreparation = {
  history: MessageType[];
  usage: ReturnType<typeof Usage.empty>;
  compaction?: {
    originalMessageCount: number;
    compactedMessageCount: number;
    retainedMessageCount: number;
    conflictRetries: number;
  };
};

type MemoryAgent = Pick<Agent, "memory">;

export class AgentRunMemory {
  constructor(
    private readonly agent: MemoryAgent,
    private readonly memoryContext: MemoryContext | undefined,
    private readonly initialHistory: MessageType[],
  ) {}

  memoryPolicy(): MemorySavePolicy | undefined {
    return this.memory()?.options.savePolicy;
  }

  pendingTurnMessages(newMessages: MessageType[]): MessageType[] {
    return this.memoryPolicy() === "turn" ? [...newMessages] : [];
  }

  async prepareHistory(runId: string, incomingMessageCount: number): Promise<MemoryPreparation> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      return {
        history: this.initialHistory,
        usage: Usage.empty(),
      };
    }

    const preparation = await this.prepareStoredHistory(memory, runId, incomingMessageCount);
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
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "message" ||
      messages.length === 0
    ) {
      return;
    }

    await memory.store.append({
      context: this.memoryContext,
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
    if (memory === undefined || this.memoryContext === undefined || messages.length === 0) {
      return;
    }
    if (memory.options.savePolicy === "message") {
      await memory.store.append({
        context: this.memoryContext,
        runId,
        turn,
        messages,
      });
    } else if (memory.options.savePolicy === "turn") {
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
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "turn" ||
      pendingTurnMessages.length === 0
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
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
    if (
      memory === undefined ||
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "run"
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
      runId,
      turn,
      messages: [...newMessages],
    });
  }

  async recordError(runId: string, error: unknown, newMessages: MessageType[]): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      return;
    }
    await memory.store.recordError?.({
      context: this.memoryContext,
      runId,
      error,
      messages: [...newMessages],
    });
  }

  private memory(): MemoryRegistration | undefined {
    return this.memoryContext === undefined ? undefined : this.agent.memory;
  }

  private async prepareStoredHistory(
    memory: MemoryRegistration,
    runId: string,
    incomingMessageCount: number,
  ): Promise<MemoryPreparation> {
    const context = this.memoryContext;
    if (context === undefined) {
      return { history: [], usage: Usage.empty() };
    }
    const options = memory.options.compaction;
    const capability = memory.store.compaction;
    if (options === undefined || capability === undefined) {
      return {
        history: await memory.store.load(context),
        usage: Usage.empty(),
      };
    }

    let usage = Usage.empty();
    let conflictRetries = 0;
    for (let attempt = 0; attempt <= options.conflictRetries; attempt += 1) {
      const snapshot = await capability.load(context);
      const compactedMessageCount = compactedPrefixLength(
        snapshot.messages,
        incomingMessageCount,
        options.maxMessages,
        options.keepRecentUserTurns,
      );
      if (compactedMessageCount === 0) {
        return { history: snapshot.messages, usage };
      }

      const prefix = snapshot.messages.slice(0, compactedMessageCount);
      let result: Awaited<ReturnType<typeof options.compactor>>;
      try {
        result = await options.compactor({
          context,
          messages: prefix,
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
      let commit: Awaited<ReturnType<typeof capability.commit>>;
      try {
        commit = await capability.commit({
          context,
          revision: snapshot.revision,
          compactedMessageCount,
          summary,
          runId: `memory-compaction:${runId}:${attempt + 1}`,
        });
      } catch (error) {
        throw new MemoryCompactionError("Memory compaction store commit failed.", {
          cause: error,
          usage,
        });
      }
      if (commit === "committed") {
        const retained = snapshot.messages.slice(compactedMessageCount);
        return {
          history: [summary, ...retained],
          usage,
          compaction: {
            originalMessageCount: snapshot.messages.length,
            compactedMessageCount,
            retainedMessageCount: retained.length,
            conflictRetries,
          },
        };
      }
      conflictRetries += 1;
    }

    throw new MemoryCompactionConflictError(options.conflictRetries + 1, usage);
  }
}

function compactedPrefixLength(
  messages: MessageType[],
  incomingMessageCount: number,
  maxMessages: number,
  keepRecentUserTurns: number,
): number {
  if (messages.length + incomingMessageCount <= maxMessages) {
    return 0;
  }
  const userMessageIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  // Keep the recent user-led tail intact. If there are not enough user messages to retain a
  // complete tail, skip compaction even when the transcript already exceeds maxMessages.
  if (userMessageIndexes.length <= keepRecentUserTurns) {
    return 0;
  }
  return userMessageIndexes[userMessageIndexes.length - keepRecentUserTurns] ?? 0;
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
