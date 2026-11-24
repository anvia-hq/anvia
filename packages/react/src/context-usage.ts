import type { ClientDataMap, ClientMetadata, ClientStreamEvent, UIMessage } from "@anvia/client";
import type { ContextUsage } from "@anvia/core/completion";
import { type ContextBreakdown, isContextBreakdown } from "@anvia/core/context";

export function contextUsageUpdateFromEvent<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(
  event: ClientStreamEvent<Metadata, Data>,
): { contextUsage: ContextUsage | undefined } | undefined {
  if (event.scope?.parentToolCallId !== undefined) return undefined;

  return event.type === "message_end" || event.type === "turn_end" || event.type === "run_end"
    ? { contextUsage: event.contextUsage }
    : undefined;
}

export function contextBreakdownUpdateFromEvent<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(
  event: ClientStreamEvent<Metadata, Data>,
): { contextBreakdown: ContextBreakdown | undefined } | undefined {
  if (event.scope?.parentToolCallId !== undefined) return undefined;

  if (event.type === "message_end" || event.type === "turn_end") {
    return { contextBreakdown: event.contextBreakdown };
  }

  if (event.type === "run_end") {
    if (
      event.contextBreakdown === undefined &&
      (event.status === "error" || event.status === "cancelled")
    ) {
      return undefined;
    }

    return { contextBreakdown: event.contextBreakdown };
  }

  return undefined;
}

export function contextUsageFromMessages<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(messages: readonly UIMessage<Metadata, Data>[]): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "assistant") continue;

    if (message.generation?.contextUsage !== undefined) return message.generation.contextUsage;

    if (isRecord(message.metadata)) {
      const anvia = message.metadata.anvia;
      const generation = isRecord(anvia) ? anvia.generation : undefined;

      if (isRecord(generation) && isContextUsage(generation.contextUsage)) {
        return generation.contextUsage;
      }
    }

    return undefined;
  }
  return undefined;
}

export function contextBreakdownFromMessages<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(messages: readonly UIMessage<Metadata, Data>[]): ContextBreakdown | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "assistant") continue;

    if (message.generation?.contextBreakdown !== undefined) {
      return message.generation.contextBreakdown;
    }

    if (isRecord(message.metadata)) {
      const anvia = message.metadata.anvia;
      const generation = isRecord(anvia) ? anvia.generation : undefined;

      if (isRecord(generation) && isContextBreakdown(generation.contextBreakdown)) {
        return generation.contextBreakdown;
      }
    }

    return undefined;
  }
  return undefined;
}

function isContextUsage(value: unknown): value is ContextUsage {
  return (
    isRecord(value) &&
    isRecord(value.model) &&
    typeof value.model.modelId === "string" &&
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
