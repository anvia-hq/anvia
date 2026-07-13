import type { StudioTrace, StudioTraceSummary } from "../types";
export function traceSummary(trace: StudioTrace): StudioTraceSummary {
  const summary: StudioTraceSummary = {
    id: trace.id,
    sessionId: trace.sessionId,
    status: trace.status,
    startedAt: trace.startedAt,
    observationCount: trace.observations.length,
  };
  if (trace.name !== undefined) summary.name = trace.name;
  if (trace.endedAt !== undefined) summary.endedAt = trace.endedAt;
  if (trace.durationMs !== undefined) summary.durationMs = trace.durationMs;
  if (trace.output !== undefined) summary.output = trace.output;
  if (trace.error !== undefined) summary.error = trace.error;
  if (trace.usage !== undefined) summary.usage = trace.usage;
  if (trace.metadata !== undefined) summary.metadata = trace.metadata;
  return summary;
}
