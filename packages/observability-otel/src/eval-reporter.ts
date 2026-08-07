import {
  type EvalReportArgs,
  type EvalReporter,
  projectEvalOutcome,
  resolveEvalTraceRef,
} from "@anvia/core/evals";
import { type Context, ROOT_CONTEXT, TraceFlags, trace } from "@opentelemetry/api";
import {
  type AnyValue,
  type AnyValueMap,
  type LogAttributes,
  type Logger,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import type { OtelEvalReporterOptions } from "./types.js";

const EVALUATION_EVENT_NAME = "gen_ai.evaluation.result";

export function createOtelEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  options: OtelEvalReporterOptions = {},
): EvalReporter<Input, Output, Expected> {
  const logger =
    options.logger ?? logs.getLogger(options.loggerName ?? "@anvia/otel", options.loggerVersion);
  const onMissingTrace = options.onMissingTrace ?? "emit";
  const publishInvalid = options.publishInvalid ?? true;
  const includeMetadata = options.includeMetadata ?? true;

  return {
    report(args) {
      if (args.outcome.outcome === "invalid" && !publishInvalid) return;
      const traceRef =
        args.trace ??
        resolveEvalTraceRef({
          output: args.output,
          input: args.case.input,
          metadata: args.case.metadata,
        });
      const eventContext = contextFromTraceRef(traceRef);
      if (eventContext === undefined && onMissingTrace !== "emit") {
        if (onMissingTrace === "throw") {
          throw new Error("OpenTelemetry eval reporter requires a valid traceId and observationId");
        }
        if (onMissingTrace === "warn") {
          console.warn(
            "[anvia/otel] eval reporter emitted no event because no valid trace context was found",
            { caseId: args.case.id, metric: args.metric.name },
          );
        }
        return;
      }
      emitEvaluation(logger, args, traceRef, eventContext, includeMetadata);
    },
  };
}

function emitEvaluation<Input, Output, Score, Expected>(
  logger: Logger,
  args: EvalReportArgs<Input, Output, Score, Expected>,
  traceRef: EvalReportArgs<Input, Output, Score, Expected>["trace"],
  eventContext: Context | undefined,
  includeMetadata: boolean,
): void {
  const projection = projectEvalOutcome(args.outcome, args.metric.dataType);
  const attributes: LogAttributes = {
    "anvia.eval.id": globalThis.crypto.randomUUID(),
    "gen_ai.evaluation.name": args.metric.name,
    "gen_ai.evaluation.score.label": projection.label,
    "anvia.eval.suite.name": args.suiteName,
    "anvia.eval.case.id": args.case.id,
    "anvia.eval.outcome": projection.outcome,
  };
  if (projection.numericValue !== undefined) {
    attributes["gen_ai.evaluation.score.value"] = projection.numericValue;
  }
  if (projection.explanation !== undefined) {
    attributes["gen_ai.evaluation.explanation"] = projection.explanation;
  }
  if (traceRef?.responseId !== undefined) {
    attributes["gen_ai.response.id"] = traceRef.responseId;
  }
  if (traceRef?.traceId !== undefined) {
    attributes["anvia.eval.target.trace_id"] = traceRef.traceId;
  }
  if (traceRef?.observationId !== undefined) {
    attributes["anvia.eval.target.observation_id"] = traceRef.observationId;
  }
  if (args.metric.dataType !== undefined) {
    attributes["anvia.eval.data_type"] = args.metric.dataType;
  }
  const configId = args.metric.configId ?? args.metric.scoreConfigId;
  if (configId !== undefined) attributes["anvia.eval.config_id"] = configId;
  if (args.outcome.outcome === "invalid") {
    attributes["error.type"] = errorType(args.targetError);
  }
  if (includeMetadata) {
    addMetadata(attributes, "anvia.eval.case.metadata", args.case.metadata);
    addMetadata(attributes, "anvia.eval.metric.metadata", args.metric.metadata);
    addMetadata(attributes, "anvia.eval.outcome.metadata", args.outcome.metadata);
  }

  const record: Parameters<Logger["emit"]>[0] = {
    eventName: EVALUATION_EVENT_NAME,
    severityNumber: args.outcome.outcome === "invalid" ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: args.outcome.outcome === "invalid" ? "ERROR" : "INFO",
    attributes,
  };
  if (eventContext !== undefined) record.context = eventContext;
  logger.emit(record);
}

function contextFromTraceRef(ref: EvalReportArgs<unknown, unknown>["trace"]): Context | undefined {
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

function addMetadata(
  attributes: LogAttributes,
  key: string,
  metadata: Record<string, unknown> | undefined,
): void {
  if (metadata === undefined) return;
  attributes[key] = toAnyValue(metadata);
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

function errorType(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "evaluation_invalid";
}

function isValidTraceId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{32}$/i.test(value) &&
    value !== "00000000000000000000000000000000"
  );
}

function isValidSpanId(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{16}$/i.test(value) && value !== "0000000000000000";
}
