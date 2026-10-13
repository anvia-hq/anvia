import { z } from "zod";
import { isJsonValue, type JsonObject, type JsonValue } from "@anvia/core/completion";
import type { DurableTraceOptions } from "./types.js";

const text = z.string().trim().min(1).max(1024);
/** Copied onto the root span of every execution, so it stays far below the payload limit. */
const MAX_TRACE_BYTES = 16_384;
export const traceOptionsSchema = z
  .object({
    name: text.optional(),
    userId: text.optional(),
    tags: z.array(text).max(50).optional(),
    metadata: z
      .record(z.string(), z.custom<JsonValue>(isJsonValue))
      .transform((value) => value as JsonObject)
      .optional(),
    version: text.optional(),
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_TRACE_BYTES,
    `Trace options must serialize to at most ${MAX_TRACE_BYTES} bytes.`,
  );

export function parseTraceOptions(value: unknown): DurableTraceOptions | undefined {
  if (value === undefined) return undefined;
  const result = traceOptionsSchema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid durable trace options.");
  return result.data;
}
