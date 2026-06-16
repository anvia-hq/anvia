export function defaultCompletionEventToDelta<TEvent>(event: TEvent): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  return event.type === "text_delta" && typeof event.delta === "string" ? event.delta : undefined;
}

export function defaultCompletionEventToFinal<TEvent>(event: TEvent): string | undefined {
  if (!isRecord(event) || event.type !== "final") {
    return undefined;
  }

  const response = event.response;
  if (!isRecord(response) || !Array.isArray(response.choice)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of response.choice) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }

  return parts.length > 0 ? parts.join("") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
