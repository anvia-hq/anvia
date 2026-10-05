import { isJsonValue } from "../completion/json";
import { COMPLETION_PROVIDER_OUTPUT_ERROR_CODE } from "../completion/provider-output-error";
import type { Usage } from "../completion/types";

export type ReadableStreamOptions = {
  format?: "jsonl";
  errorSerialization?: "anvia";
};

export function toReadableStream<T>(
  events: AsyncIterable<T>,
  options: ReadableStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let state: "open" | "terminal" | "cancelled" = "open";
  let cleanup: Promise<void> | undefined;

  function finishIterator(): Promise<void> {
    cleanup ??= Promise.resolve().then(async () => {
      await iterator.return?.();
    });
    return cleanup;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (state !== "open") return;
      try {
        const next = await iterator.next();
        if (state !== "open") return;
        if (next.done === true) {
          state = "terminal";
          controller.close();
          return;
        }

        const terminal =
          options.errorSerialization === "anvia" &&
          readDataProperty(next.value, "type") === "error";
        const value = terminal
          ? anviaErrorEnvelope(
              readDataProperty(next.value, "error"),
              readDataProperty(next.value, "usage"),
            )
          : next.value;
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        if (terminal) {
          state = "terminal";
          controller.close();
          await finishIterator().catch(() => {});
        }
      } catch (error) {
        if (state !== "open") return;
        const value =
          options.errorSerialization === "anvia"
            ? anviaErrorEnvelope(error)
            : { type: "error", error: serializeError(error) };
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        state = "terminal";
        controller.close();
        await finishIterator().catch(() => {});
      }
    },
    async cancel() {
      state = "cancelled";
      await finishIterator();
    },
  });
}

type SafeScalar = string | number | boolean | null;
type SafeError = SafeScalar | Record<string, SafeScalar>;
type TerminalErrorWire = { type: "error"; error: SafeError; usage?: Usage };

function anviaErrorEnvelope(error: unknown, usage?: unknown): TerminalErrorWire {
  const envelope: TerminalErrorWire = Object.create(null);
  envelope.type = "error";
  envelope.error = normalizeAnviaError(error);
  const safeUsage = projectUsage(usage);
  if (safeUsage !== undefined) envelope.usage = safeUsage;
  return envelope;
}

function normalizeAnviaError(error: unknown): SafeError {
  if (isSafeScalar(error)) return error;
  if (typeof error === "bigint") return { message: String(error) };

  const diagnostic: Record<string, SafeScalar> = Object.create(null);
  for (const key of ["name", "message"]) {
    const value = readDataProperty(error, key);
    if (typeof value === "string") diagnostic[key] = value;
  }
  const code = readDataProperty(error, "code");
  if (isSafeScalar(code)) diagnostic.code = code;

  if (code === COMPLETION_PROVIDER_OUTPUT_ERROR_CODE) {
    const kind = readDataProperty(error, "kind");
    if (typeof kind === "string" && providerOutputKinds.has(kind)) {
      diagnostic.kind = kind;
      const toolCallId = readDataProperty(error, "toolCallId");
      if (typeof toolCallId === "string" && toolCallId.length > 0) {
        diagnostic.toolCallId = toolCallId;
      }
      const finishReason = readDataProperty(error, "finishReason");
      if (typeof finishReason === "string" && finishReasons.has(finishReason)) {
        diagnostic.finishReason = finishReason;
      }
    }
  }

  return Object.keys(diagnostic).length > 0 ? diagnostic : { message: "Unknown error" };
}

const providerOutputKinds = new Set([
  "malformed-tool-arguments",
  "invalid-tool-arguments",
  "invalid-stream-event",
  "invalid-response",
  "incomplete-stream",
  "incomplete-tool-call",
  "invalid-tool-call",
  "truncated-tool-call",
  "filtered-tool-call",
]);
const finishReasons = new Set(["stop", "length", "content-filter", "tool-calls", "other"]);

function isSafeScalar(value: unknown): value is SafeScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function readDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  try {
    let object: object | null = value;
    for (let depth = 0; object !== null && depth < 32; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor !== undefined) return "value" in descriptor ? descriptor.value : undefined;
      object = Object.getPrototypeOf(object);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function projectUsage(value: unknown): Usage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage: Usage = Object.create(null);
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
  ] as const) {
    const count = readDataProperty(value, key);
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return undefined;
    usage[key] = count;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "details");
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) return undefined;
      const details: unknown = descriptor.value;
      if (details !== undefined) {
        if (typeof details !== "object" || details === null || Array.isArray(details)) {
          return undefined;
        }
        const counts: Record<string, number> = Object.create(null);
        for (const key of Object.keys(details)) {
          const field = Object.getOwnPropertyDescriptor(details, key);
          if (
            field === undefined ||
            !("value" in field) ||
            typeof field.value !== "number" ||
            !Number.isFinite(field.value) ||
            field.value < 0
          ) {
            return undefined;
          }
          counts[key] = field.value;
        }
        usage.details = counts;
      }
    }
  } catch {
    return undefined;
  }
  return usage;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    const serialized: { name: string; message: string; code?: unknown; details?: unknown } = {
      name: error.name,
      message: error.message,
    };
    // Runtime-specific Error subclasses (for example bun:sqlite's SqliteError)
    // can keep diagnostic fields such as `code` on the prototype, where
    // JSON.stringify drops them. Copy well-known diagnostic fields explicitly.
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) {
      serialized.code = code;
    }
    const details = (error as { details?: unknown }).details;
    if (details !== undefined) {
      serialized.details = details;
    }
    return serialized;
  }

  if (isJsonValue(error)) {
    return error;
  }

  // A thrown non-Error that is not JSON-safe would serialize as `{}` or lose
  // its diagnostics entirely; degrade to a string payload instead.
  return { message: String(error) };
}
