import type { EvalOutcome } from "./outcome";
import type {
  EvalMetadata,
  EvalMetric,
  EvalScoreProjection,
  EvalTraceRef,
  EvalTraceSelectorArgs,
} from "./types";

export function projectEvalOutcome<Score>(
  outcome: EvalOutcome<Score>,
  dataType: EvalMetric<unknown, unknown>["dataType"],
  projectScore?: ((score: Score) => number | string | boolean) | undefined,
): EvalScoreProjection {
  const value = projectScoreValue(outcome, dataType, projectScore);
  const projection: EvalScoreProjection = {
    outcome: outcome.outcome,
    value,
    label: typeof value === "string" ? value : outcome.outcome,
  };
  if (typeof value === "number") projection.numericValue = value;
  if (typeof value === "string") projection.categoricalValue = value;
  const explanation =
    outcome.comment ?? (outcome.outcome === "invalid" ? outcome.reason : undefined);
  if (explanation !== undefined) projection.explanation = explanation;
  return projection;
}

export function resolveEvalTraceRef(args: {
  output?: unknown;
  input?: unknown;
  metadata?: EvalMetadata | undefined;
}): EvalTraceRef | undefined {
  return (
    traceFromCarrier(args.output) ??
    traceFromCarrier(args.input) ??
    traceFromMetadata(args.metadata)
  );
}

export function defaultEvalTraceSelector<Input, Output, Expected>(
  args: EvalTraceSelectorArgs<Input, Output, Expected>,
): EvalTraceRef | undefined {
  return resolveEvalTraceRef({
    output: args.output,
    input: args.case.input,
    metadata: args.case.metadata,
  });
}

function projectScoreValue<Score>(
  outcome: EvalOutcome<Score>,
  dataType: EvalMetric<unknown, unknown>["dataType"],
  projectScore: ((score: Score) => number | string | boolean) | undefined,
): number | string {
  const score = outcome.score;
  if (score !== undefined && projectScore !== undefined) {
    const projected = projectScore(score);
    if (typeof projected === "boolean") return projected ? 1 : 0;
    return projected;
  }
  if (dataType === "CATEGORICAL") {
    if (typeof score === "string") return score;
    if (typeof score === "number") return String(score);
    if (typeof score === "boolean") return score ? "true" : "false";
    if (score === null || score === undefined) return outcome.outcome;
    try {
      return JSON.stringify(score) ?? outcome.outcome;
    } catch {
      return outcome.outcome;
    }
  }
  if (dataType === "BOOLEAN") {
    if (typeof score === "boolean") return score ? 1 : 0;
    if (typeof score === "number") return score === 0 ? 0 : 1;
    return outcome.outcome === "pass" ? 1 : 0;
  }
  if (typeof score === "number") return score;
  if (typeof score === "boolean") return score ? 1 : 0;
  if (
    typeof score === "object" &&
    score !== null &&
    "score" in score &&
    typeof (score as { score?: unknown }).score === "number"
  ) {
    return (score as { score: number }).score;
  }
  return outcome.outcome === "pass" ? 1 : 0;
}

function traceFromCarrier(value: unknown): EvalTraceRef | undefined {
  if (typeof value !== "object" || value === null || !("trace" in value)) return undefined;
  return readTraceRef((value as { trace?: unknown }).trace);
}

function traceFromMetadata(metadata: EvalMetadata | undefined): EvalTraceRef | undefined {
  if (metadata === undefined) return undefined;
  return readTraceRef({
    traceId: metadata.traceId,
    observationId: metadata.observationId,
    responseId: metadata.responseId,
  });
}

function readTraceRef(value: unknown): EvalTraceRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const traceId = (value as { traceId?: unknown }).traceId;
  if (typeof traceId !== "string" || traceId.length === 0) return undefined;
  const observationId = (value as { observationId?: unknown }).observationId;
  const responseId = (value as { responseId?: unknown }).responseId;
  const trace: EvalTraceRef = { traceId };
  if (typeof observationId === "string" && observationId.length > 0) {
    trace.observationId = observationId;
  }
  if (typeof responseId === "string" && responseId.length > 0) trace.responseId = responseId;
  return trace;
}
