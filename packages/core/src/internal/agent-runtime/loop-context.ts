import { Usage, type Message } from "../../completion";
import {
  createMemoryCompactionSummary,
  cumulativeCompactedMessageCount,
} from "../../memory/compaction";
import { MemoryCompactionError } from "../../memory/errors";
import { estimateMemoryTokens } from "../../memory/options";
import type {
  MemoryCompactionInfo,
  MemoryCompactor,
  MemoryScope,
  MemoryTokenCounter,
} from "../../memory/types";
import { throwIfAborted } from "../abort";

/** Indexes refer to the unchanged input transcript of this execution segment. */
export type LoopContextCheckpoint = {
  summary: string;
  coveredMessages: number;
  compactedMessageCount: number;
};
export type PreparedLoopContext = {
  messages: Message[];
  checkpoint?: LoopContextCheckpoint | undefined;
  compaction?: MemoryCompactionInfo | undefined;
};
export type LoopContextPlan = {
  messages: Message[];
  prefix: Message[];
  coveredMessages: number;
  compactedMessageCount: number;
  originalMessageCount: number;
  originalTokenCount: number;
  compactedTokenCount: number;
  retainedTokenCount: number;
};

async function countContextTokens(
  counter: MemoryTokenCounter,
  messages: readonly Message[],
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const value = await counter(structuredClone(messages));
  throwIfAborted(signal);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Compaction token counter must return a nonnegative safe integer.");
  return value;
}

export function projectLoopContext(
  messages: readonly Message[],
  checkpoint?: LoopContextCheckpoint,
): Message[] {
  if (checkpoint === undefined) return [...messages];
  return [
    createMemoryCompactionSummary(checkpoint.summary, checkpoint.compactedMessageCount),
    ...retainedLoopMessages(messages, checkpoint.coveredMessages),
  ];
}

function retainedLoopMessages(messages: readonly Message[], coveredMessages: number): Message[] {
  const tail = messages.slice(coveredMessages);
  // Keep the active user request verbatim even when all completed tool rounds are summarized.
  let latestUser = messages.length - 1;
  while (latestUser >= 0 && messages[latestUser]!.role !== "user") latestUser -= 1;
  return latestUser >= 0 && latestUser < coveredMessages ? [messages[latestUser]!, ...tail] : tail;
}

/** Select only complete exchanges; parallel tool calls must all have results before a cut. */
export async function planLoopContext(
  messages: readonly Message[],
  checkpoint: LoopContextCheckpoint | undefined,
  options: {
    afterTokens: number;
    recentToolTurns?: number | undefined;
    tokenCounter?: MemoryTokenCounter | undefined;
  },
  signal?: AbortSignal,
): Promise<LoopContextPlan | undefined> {
  const counter = options.tokenCounter ?? estimateMemoryTokens;
  const projected = projectLoopContext(messages, checkpoint);
  const originalTokenCount = await countContextTokens(counter, projected, signal);
  if (originalTokenCount <= options.afterTokens) return undefined;
  const boundaries: number[] = [];
  const pending = new Set<string>();
  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content)
        if (part.type === "tool-call") pending.add(part.toolCallId);
    }
    if (message.role === "tool" && pending.size > 0) {
      for (const part of message.content)
        if (part.type === "tool-result") pending.delete(part.toolCallId);
      if (pending.size === 0) boundaries.push(index + 1);
    } else if (message.role === "assistant" && pending.size === 0 && boundaries.at(-1) === index) {
      // A final answer belongs to the preceding completed round, not another retained tool round.
      boundaries[boundaries.length - 1] = index + 1;
    }
  }
  const end = boundaries[boundaries.length - 1 - (options.recentToolTurns ?? 1)] ?? 0;
  if (end <= (checkpoint?.coveredMessages ?? 0)) return undefined;
  const prefix =
    checkpoint === undefined
      ? messages.slice(0, end)
      : [
          createMemoryCompactionSummary(checkpoint.summary, checkpoint.compactedMessageCount),
          ...messages.slice(checkpoint.coveredMessages, end),
        ];
  const retained = retainedLoopMessages(messages, end);
  return {
    messages: retained,
    prefix,
    coveredMessages: end,
    compactedMessageCount: cumulativeCompactedMessageCount(messages.slice(0, end)),
    originalMessageCount: projected.length,
    originalTokenCount,
    compactedTokenCount: await countContextTokens(counter, prefix, signal),
    retainedTokenCount: await countContextTokens(counter, retained, signal),
  };
}

/** Validation is inside the summarizer boundary so durable retry budgets cover invalid results. */
export async function summarizeLoopContext(
  plan: LoopContextPlan,
  compactor: MemoryCompactor,
  scope: MemoryScope,
  signal?: AbortSignal,
): Promise<{ summary: string; usage: Usage }> {
  throwIfAborted(signal);
  const result = await compactor({
    scope,
    messages: structuredClone(plan.prefix),
    abortSignal: signal,
  });
  throwIfAborted(signal);
  const usage = result?.usage ?? Usage.empty();
  if (typeof result?.summary !== "string" || result.summary.trim().length === 0)
    throw new MemoryCompactionError("Memory compactor returned an empty summary.", { usage });
  for (const value of [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.cachedInputTokens,
    usage.cacheCreationInputTokens,
  ])
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid compaction usage.");
  if (
    usage.details !== undefined &&
    Object.values(usage.details).some((value) => !Number.isFinite(value))
  )
    throw new TypeError("Invalid compaction usage details.");
  return { summary: result.summary.trim(), usage };
}

export async function finishLoopContext(
  plan: LoopContextPlan,
  result: { summary: string; usage: Usage },
  counter: MemoryTokenCounter = estimateMemoryTokens,
  signal?: AbortSignal,
  attempts = 1,
): Promise<PreparedLoopContext> {
  const checkpoint = {
    summary: result.summary,
    coveredMessages: plan.coveredMessages,
    compactedMessageCount: plan.compactedMessageCount,
  };
  const messages = [
    createMemoryCompactionSummary(result.summary, plan.compactedMessageCount),
    ...plan.messages,
  ];
  let resultTokenCount: number;
  try {
    resultTokenCount = await countContextTokens(counter, messages, signal);
  } catch (error) {
    throw new MemoryCompactionError("Memory token counter failed after summarization.", {
      cause: error,
      usage: result.usage,
    });
  }
  return {
    messages,
    checkpoint,
    compaction: {
      originalMessageCount: plan.originalMessageCount,
      compactedMessageCount: plan.prefix.length,
      retainedMessageCount: plan.messages.length,
      originalTokenCount: plan.originalTokenCount,
      compactedTokenCount: plan.compactedTokenCount,
      retainedTokenCount: plan.retainedTokenCount,
      resultTokenCount,
      attempts,
      usage: result.usage,
    },
  };
}
