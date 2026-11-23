import type { ContextBreakdown } from "@anvia/core/context";
import type { StudioTrace, StudioTraceObservation, StudioTraceSummary } from "../types";

export function traceSummary(trace: StudioTrace): StudioTraceSummary {
  const summary: StudioTraceSummary = {
    id: trace.id,
    sessionId: trace.sessionId,
    status: trace.status,
    startedAt: trace.startedAt,
    observationCount: trace.observations.length,
  };

  if (trace.runId !== undefined) summary.runId = trace.runId;

  if (trace.name !== undefined) summary.name = trace.name;

  if (trace.endedAt !== undefined) summary.endedAt = trace.endedAt;

  if (trace.durationMs !== undefined) summary.durationMs = trace.durationMs;

  if (trace.output !== undefined) summary.output = trace.output;

  if (trace.error !== undefined) summary.error = trace.error;

  if (trace.usage !== undefined) summary.usage = trace.usage;

  if (trace.context !== undefined) summary.context = trace.context;

  if (trace.metadata !== undefined) summary.metadata = trace.metadata;

  return summary;
}

/**
 * The latest input token split a trace recorded. Generations store it in their observation
 * metadata; the last one describes the context the run ended on.
 */
export function traceContextBreakdown(
  observations: readonly StudioTraceObservation[],
): ContextBreakdown | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index];

    if (observation?.kind !== "generation") continue;

    const context = observation.metadata?.context;

    if (isContextBreakdown(context)) return context;
  }
  return undefined;
}

function isContextBreakdown(value: unknown): value is ContextBreakdown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const candidate = value as Partial<ContextBreakdown>;
  return (
    typeof candidate.estimatedTokens === "number" &&
    Array.isArray(candidate.segments) &&
    candidate.segments.every((segment) => typeof segment?.tokens === "number")
  );
}
