import type { ClientDataMap, ClientStreamEvent, UIMessage } from "@anvia/client";
import type { ContextUsage } from "@anvia/core/completion";

export function contextUsageUpdateFromEvent<TData extends ClientDataMap>(
  event: ClientStreamEvent<TData>,
): ContextUsage | undefined {
  return event.type === "message_end" || event.type === "turn_end" || event.type === "run_end"
    ? event.contextUsage
    : undefined;
}

export function contextUsageFromMessages(messages: UIMessage[]): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !isRecord(message.metadata)) continue;
    const anvia = message.metadata.anvia;
    const generation = isRecord(anvia) ? anvia.generation : undefined;
    if (isRecord(generation) && isContextUsage(generation.contextUsage)) {
      return generation.contextUsage;
    }
  }
  return undefined;
}

function isContextUsage(value: unknown): value is ContextUsage {
  return (
    isRecord(value) &&
    isRecord(value.model) &&
    typeof value.model.id === "string" &&
    isRecord(value.model.context) &&
    typeof value.model.context.contextWindow === "number" &&
    typeof value.usedTokens === "number" &&
    typeof value.remainingTokens === "number" &&
    typeof value.usedPercent === "number" &&
    typeof value.remainingPercent === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
