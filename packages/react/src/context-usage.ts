import type { ContextUsage } from "@anvia/core/completion";
import type { UIMessage } from "@anvia/core/ui";

export type ContextUsageUpdate = {
  contextUsage: ContextUsage | undefined;
};

export function contextUsageUpdateFromEvent(event: unknown): ContextUsageUpdate | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (event.type === "message_end") {
    return { contextUsage: contextUsageValue(event.contextUsage) };
  }

  if (event.type === "final") {
    const direct = contextUsageValue(event.contextUsage);
    const result = isRecord(event.result)
      ? contextUsageValue(event.result.contextUsage)
      : undefined;
    return { contextUsage: direct ?? result };
  }

  return undefined;
}

export function contextUsageFromMessages(messages: UIMessage[]): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !isRecord(message.metadata)) {
      continue;
    }
    const anvia = message.metadata.anvia;
    const generation = isRecord(anvia) ? anvia.generation : undefined;
    if (isRecord(generation)) {
      return contextUsageValue(generation.contextUsage);
    }
  }
  return undefined;
}

function contextUsageValue(value: unknown): ContextUsage | undefined {
  if (!isRecord(value) || !isRecord(value.model) || !isRecord(value.model.context)) {
    return undefined;
  }
  if (
    typeof value.model.id !== "string" ||
    !isPositiveNumber(value.model.context.contextWindow) ||
    !isOptionalPositiveNumber(value.model.context.maxInputTokens) ||
    !isOptionalPositiveNumber(value.model.context.maxOutputTokens) ||
    !isNonnegativeNumber(value.usedTokens) ||
    !isNonnegativeNumber(value.remainingTokens) ||
    !isPercentage(value.usedPercent) ||
    !isPercentage(value.remainingPercent)
  ) {
    return undefined;
  }
  const contextWindow = value.model.context.contextWindow;
  const remainingTokens = Math.max(0, contextWindow - value.usedTokens);
  const usedPercent = Math.min(100, (value.usedTokens / contextWindow) * 100);
  const remainingPercent = (remainingTokens / contextWindow) * 100;
  if (
    value.remainingTokens !== remainingTokens ||
    !approximatelyEqual(value.usedPercent, usedPercent) ||
    !approximatelyEqual(value.remainingPercent, remainingPercent)
  ) {
    return undefined;
  }
  return value as unknown as ContextUsage;
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 8;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isNonnegativeNumber(value) && value > 0;
}

function isOptionalPositiveNumber(value: unknown): boolean {
  return value === undefined || isPositiveNumber(value);
}

function isPercentage(value: unknown): value is number {
  return isNonnegativeNumber(value) && value <= 100;
}
