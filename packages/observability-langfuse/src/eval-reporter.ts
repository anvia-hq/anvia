import type { EvalOutcome, EvalReportArgs, EvalReporter } from "@anvia/core/evals";
import type { AgentTraceInfo } from "@anvia/core/observability";
import type { LangfuseEvalReporterOptions, LangfuseTracing } from "./types.js";

export function createLangfuseEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: Pick<LangfuseTracing, "score">,
  options: LangfuseEvalReporterOptions = {},
): EvalReporter<Input, Output, Expected> {
  return {
    async report(args) {
      if (args.outcome.outcome === "invalid" && options.publishInvalid !== true) {
        return;
      }

      const trace = traceFromEvalReport(args);
      if (trace?.traceId === undefined || trace.traceId.length === 0) {
        if (options.strict === true) {
          throw new Error("Langfuse eval reporter requires traceId");
        }
        return;
      }

      await tracing.score({
        traceId: trace.traceId,
        name: args.metric.name,
        value: scoreValue(args.outcome),
        metadata: {
          suiteName: args.suiteName,
          caseId: args.case.id,
          outcome: args.outcome.outcome,
        },
        ...(trace.observationId === undefined ? {} : { observationId: trace.observationId }),
        ...(scoreComment(args.outcome) === undefined
          ? {}
          : { comment: scoreComment(args.outcome) as string }),
      });
    },
  };
}

function scoreValue(outcome: EvalOutcome): number {
  if (outcome.outcome === "invalid") {
    return 0;
  }
  if (typeof outcome.score === "number") {
    return outcome.score;
  }
  if (typeof outcome.score === "boolean") {
    return outcome.score ? 1 : 0;
  }
  if (
    typeof outcome.score === "object" &&
    outcome.score !== null &&
    "score" in outcome.score &&
    typeof (outcome.score as { score?: unknown }).score === "number"
  ) {
    return (outcome.score as { score: number }).score;
  }
  return outcome.outcome === "pass" ? 1 : 0;
}

function scoreComment(outcome: EvalOutcome): string | undefined {
  return outcome.comment ?? (outcome.outcome === "invalid" ? outcome.reason : undefined);
}

function traceFromEvalReport<Input, Output, Expected>(
  args: EvalReportArgs<Input, Output, unknown, Expected>,
): AgentTraceInfo | undefined {
  const outputTrace = traceFromOutput(args.output);
  if (outputTrace !== undefined) {
    return outputTrace;
  }
  const traceId = args.case.metadata?.traceId;
  const observationId = args.case.metadata?.observationId;
  if (typeof traceId !== "string") {
    return undefined;
  }
  return {
    traceId,
    ...(typeof observationId === "string" ? { observationId } : {}),
  };
}

function traceFromOutput(output: unknown): AgentTraceInfo | undefined {
  if (typeof output !== "object" || output === null || !("trace" in output)) {
    return undefined;
  }
  const trace = (output as { trace?: unknown }).trace;
  if (typeof trace !== "object" || trace === null) {
    return undefined;
  }
  const traceId = (trace as { traceId?: unknown }).traceId;
  const observationId = (trace as { observationId?: unknown }).observationId;
  if (typeof traceId !== "string") {
    return undefined;
  }
  return {
    traceId,
    ...(typeof observationId === "string" ? { observationId } : {}),
  };
}
