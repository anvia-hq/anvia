import type {
  CompletionModel,
  JsonValue,
  Message as MessageType,
  StreamingCompletionModel,
} from "../completion/index";

export function isStreamingCompletionModel(
  model: CompletionModel,
): model is StreamingCompletionModel {
  return "streamCompletion" in model && typeof model.streamCompletion === "function";
}

export function extractRagText(message: MessageType): string | undefined {
  if (message.role === "user") {
    return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  }

  if (message.role === "tool") {
    return message.content
      .flatMap((item) => item.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
      .join("\n");
  }

  return undefined;
}

export function parseJsonValue(text: string): JsonValue {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await mapper(item);
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
