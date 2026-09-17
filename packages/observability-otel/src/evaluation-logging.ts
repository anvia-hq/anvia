import { type Context, ROOT_CONTEXT, TraceFlags, trace } from "@opentelemetry/api";
import type { AnyValue, AnyValueMap, LogAttributes } from "@opentelemetry/api-logs";
import { isValidSpanId, isValidTraceId, isRecord } from "./helpers.js";

export const EVALUATION_EVENT_NAME = "gen_ai.evaluation.result";

export type EvaluationTraceRef = {
  traceId: string;
  observationId?: string | undefined;
};

export function contextFromTraceRef(ref: EvaluationTraceRef | undefined): Context | undefined {
  if (ref === undefined || !isValidTraceId(ref.traceId) || !isValidSpanId(ref.observationId)) {
    return undefined;
  }
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: ref.traceId,
    spanId: ref.observationId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

export function addMetadata(
  attributes: LogAttributes,
  key: string,
  metadata: Record<string, unknown> | undefined,
  transform?: ((metadata: Record<string, unknown>) => Record<string, unknown>) | undefined,
): void {
  if (metadata === undefined) return;
  const transformed = transform === undefined ? metadata : transform(metadata);
  // A transform that does not return a record would silently ship unredacted metadata, so drop it.
  if (!isRecord(transformed)) return;
  attributes[key] = toAnyValue(transformed);
}

function toAnyValue(value: unknown): AnyValue {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(toAnyValue);
  if (typeof value === "object") {
    const result: AnyValueMap = {};
    for (const [key, entry] of Object.entries(value)) result[key] = toAnyValue(entry);
    return result;
  }
  return String(value);
}
