import { CompletionProviderOutputError } from "@anvia/core/completion";

/** Azure streams may omit the terminal function name; resolve it within this request. */
export async function* normalizeAzureResponsesStream(
  stream: AsyncIterable<unknown>,
): AsyncIterable<unknown> {
  const namesByItemId = new Map<string, string>();
  for await (const event of stream) {
    if (!isRecord(event)) {
      yield event;
      continue;
    }
    if (
      event.type === "response.output_item.added" &&
      isRecord(event.item) &&
      event.item.type === "function_call" &&
      typeof event.item.name === "string"
    ) {
      const id = event.item.id ?? event.item.call_id;
      if (typeof id === "string") namesByItemId.set(id, event.item.name);
    }
    if (event.type === "response.function_call_arguments.done" && event.name === undefined) {
      const id = typeof event.item_id === "string" ? event.item_id : undefined;
      const name = id === undefined ? undefined : namesByItemId.get(id);
      if (name === undefined || name.trim().length === 0) {
        throw new CompletionProviderOutputError({ kind: "invalid-tool-call", toolCallId: id });
      }
      yield { ...event, name };
    } else {
      yield event;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
