import type { Message } from "@anvia/core/completion";
import type { DurableRunRecord, DurableTransaction } from "./types.js";

/**
 * Progress a settled (failed, cancelled, or otherwise unfinished) run made beyond
 * its recorded history, so the session's next run continues from partial work
 * instead of silently dropping it.
 *
 * Prefers the run's exhaustion messages; otherwise falls back to the input of the
 * latest context operation for the run's epoch, which holds the prepared messages
 * at the furthest checkpoint. Returns only a tail that contains an assistant
 * message, so a bare repeated prompt is never treated as progress.
 */
export function settledProgress(tx: DurableTransaction, run: DurableRunRecord): Message[] {
  const input = run.input?.messages;
  if (!Array.isArray(input)) return [];
  let messages: readonly unknown[] | undefined = run.exhaustion?.messages;
  if (messages === undefined) {
    const prefix = `${run.epoch}:context:`;
    let latest: { turn: number; key: string } | undefined;
    for (const operation of tx.operations(run.id)) {
      if (operation.kind !== "context" || !operation.key.startsWith(prefix)) continue;
      const turn = Number(operation.key.slice(prefix.length));
      if (latest === undefined || turn > latest.turn) latest = { turn, key: operation.key };
    }
    if (latest === undefined) return [];
    const saved = tx.getOperation(run.id, latest.key)?.input;
    if (!Array.isArray(saved)) return [];
    messages = saved;
  }
  if (!Array.isArray(messages)) return [];
  const progress = (messages as Message[]).slice(input.length - 1);
  return progress.some((message) => message.role === "assistant") ? progress : [];
}
