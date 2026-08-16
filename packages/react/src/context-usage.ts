import type { ClientDataMap, ClientMetadata, ClientStreamEvent, UIMessage } from "@anvia/client";
import type { ContextUsage } from "@anvia/core/completion";

export function contextUsageUpdateFromEvent<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(event: ClientStreamEvent<Metadata, Data>): ContextUsage | undefined {
  return event.type === "message_end" || event.type === "turn_end" || event.type === "run_end"
    ? event.contextUsage
    : undefined;
}

export function contextUsageFromMessages<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(messages: readonly UIMessage<Metadata, Data>[]): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    if (message.generation?.contextUsage !== undefined) return message.generation.contextUsage;
    if (!isRecord(message.metadata)) continue;
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
