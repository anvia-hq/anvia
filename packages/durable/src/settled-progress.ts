import type { CompletionRequest, Message } from "@anvia/core/completion";
import type { DurableRunRecord, DurableTransaction } from "./types.js";

/**
 * Progress a settled (failed, cancelled, or otherwise unfinished) run made beyond
 * its recorded history, so the session's next run continues from partial work
 * instead of silently dropping it.
 *
 * Prefers the run's exhaustion messages; otherwise falls back to the input of the
 * latest context operation for the run's epoch. Without loop compaction, model
 * requests also retain the transcript (with interaction-only tool parts removed).
 * Approval continuations already committed their preceding segment to history,
 * so their progress starts after that segment and may consist only of tool results.
 */
export function settledProgress(tx: DurableTransaction, run: DurableRunRecord): Message[] {
  const input = run.input.messages;
  const continued = !Array.isArray(input);
  const compacted = run.contextCheckpoint?.compactedMessageCount;
  let start = continued
    ? run.history.length - (compacted === undefined ? 0 : compacted - 1)
    : input.length - 1;
  let messages: readonly unknown[] | undefined = run.exhaustion?.messages;
  if (messages === undefined) {
    let latest: { turn: number; key: string; kind: "context" | "model" } | undefined;
    for (const operation of tx.operations(run.id)) {
      if (
        operation.kind !== "context" &&
        (operation.kind !== "model" || run.loopCompaction === true)
      )
        continue;
      const prefix = `${run.epoch}:${operation.kind}:`;
      if (!operation.key.startsWith(prefix)) continue;
      const turn = Number(operation.key.slice(prefix.length));
      if (!Number.isSafeInteger(turn) || turn < 1) continue;
      if (
        latest === undefined ||
        turn > latest.turn ||
        (turn === latest.turn && operation.kind === "context")
      ) {
        latest = { turn, key: operation.key, kind: operation.kind };
      }
    }
    if (latest === undefined) return [];
    const saved = tx.getOperation(run.id, latest.key);
    if (saved === undefined) return [];
    if (latest.kind === "context") {
      messages = Array.isArray(saved.input) ? saved.input : undefined;
    } else {
      messages = (saved.input as unknown as { request: CompletionRequest }).request.chatHistory;
      start = continued
        ? providerMessageCount(run.history.slice(compacted ?? 0)) +
          (compacted === undefined ? 0 : 1)
        : providerMessageCount(input.slice(0, -1));
    }
  }
  if (!Array.isArray(messages)) return [];
  const progress = (messages as Message[]).slice(start);
  return progress.some(
    (message) =>
      message.role === "assistant" ||
      (continued &&
        message.role === "tool" &&
        message.content.some((part) => part.type === "tool-result")),
  )
    ? progress
    : [];
}

/** Keep only complete tool exchanges when cancellation precedes the next checkpoint. */
export function settledHistory(tx: DurableTransaction, run: DurableRunRecord): Message[] {
  const messages = [...run.history, ...settledProgress(tx, run)];
  const pending = new Set<string>();
  let exchangeStart = 0;
  for (const [index, message] of messages.entries()) {
    if (pending.size > 0 && message.role !== "tool") return messages.slice(0, exchangeStart);
    if (message.role === "assistant" && Array.isArray(message.content)) {
      exchangeStart = index;
      for (const part of message.content) {
        if (part.type === "tool-call") pending.add(part.toolCallId);
      }
    } else if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-result") pending.delete(part.toolCallId);
      }
    }
  }
  return pending.size > 0 ? messages.slice(0, exchangeStart) : messages;
}

function providerMessageCount(messages: readonly Message[]): number {
  return messages.filter(
    (message) =>
      message.role !== "tool" || message.content.some((part) => part.type === "tool-result"),
  ).length;
}
