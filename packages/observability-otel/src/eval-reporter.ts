import {
  type EvalReportArgs,
  type EvalReporter,
  type EvalRunEndArgs,
  type EvalRunStartArgs,
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
  const includePayloads = options.includePayloads ?? false;
  const traceObserver = options.traceObserver ?? "otel";

  return {
    onRunStart(args) {
      emitRunStarted(logger, args, includeMetadata);
    },
    report(args) {
      if (args.outcome.outcome === "invalid" && !publishInvalid) return;
      const resolvedTraceRef =
        args.trace ??
        resolveEvalTraceRef({
          output: args.output,
          input: args.case.input,
          metadata: args.case.metadata,
        });
      const traceRef =
        resolvedTraceRef?.observer === undefined || resolvedTraceRef.observer === traceObserver
          ? resolvedTraceRef
          : undefined;
      const eventContext = contextFromTraceRef(traceRef);
      if (eventContext === undefined && onMissingTrace !== "emit") {
        if (onMissingTrace === "throw") {
          throw new Error(
            `OpenTelemetry eval reporter requires a valid traceId and observationId from observer ${JSON.stringify(traceObserver)}`,
          );
        }
        if (onMissingTrace === "warn") {
          console.warn(
            "[anvia/otel] eval reporter emitted no event because no valid trace context was found",
            { caseId: args.case.id, metric: args.metric.name },
          );
        }
        return;
      }
      emitEvaluation(logger, args, traceRef, eventContext, includeMetadata, {
        includePayloads,
        captureMaxBytes: options.captureMaxBytes,
        transformInput: options.transformInput,
        transformOutput: options.transformOutput,
      });
    },
    onRunEnd(args) {
      emitRunFinished(logger, args, includeMetadata);
    },
  };
}

function emitEvaluation<Input, Output, Score, Expected>(
  logger: Logger,
  args: EvalReportArgs<Input, Output, Score, Expected>,
  traceRef: EvalReportArgs<Input, Output, Score, Expected>["trace"],
  eventContext: Context | undefined,
  includeMetadata: boolean,
  payloadOptions: Pick<
    OtelEvalReporterOptions,
    "includePayloads" | "captureMaxBytes" | "transformInput" | "transformOutput"
  >,
): void {
  const projection = projectEvalOutcome(
    args.outcome,
    args.metric.dataType,
    args.metric.projectScore,
  );
  const attributes: LogAttributes = {
    "anvia.eval.id": globalThis.crypto.randomUUID(),
    "gen_ai.evaluation.name": args.metric.name,
    "gen_ai.evaluation.score.label": projection.label,
    "anvia.eval.suite.name": args.suiteName,
    "anvia.eval.case.id": args.case.id,
    "anvia.eval.outcome": projection.outcome,
  };
  if (args.run !== undefined) addRunAttributes(attributes, args.run, includeMetadata);
  if (projection.numericValue !== undefined) {
    attributes["gen_ai.evaluation.score.value"] = projection.numericValue;
  }
  if (projection.explanation !== undefined) {
    attributes["gen_ai.evaluation.explanation"] = projection.explanation;
  }
  if (traceRef?.responseId !== undefined) {
    attributes["gen_ai.response.id"] = traceRef.responseId;
  }
  if (traceRef?.observer !== undefined) {
    attributes["anvia.eval.target.observer"] = traceRef.observer;
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
  attributes["anvia.eval.required"] = args.metric.required ?? true;
  if (args.metric.direction !== undefined) {
    attributes["anvia.eval.score.direction"] = args.metric.direction;
  }
  if (args.metric.threshold !== undefined) {
    attributes["anvia.eval.score.threshold"] = args.metric.threshold;
  }
  if (args.outcome.usage !== undefined) {
    attributes["anvia.eval.usage.input_tokens"] = args.outcome.usage.inputTokens;
    attributes["anvia.eval.usage.output_tokens"] = args.outcome.usage.outputTokens;
    attributes["anvia.eval.usage.total_tokens"] = args.outcome.usage.totalTokens;
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
  if (payloadOptions.includePayloads) {
    addEvaluationPayload(attributes, args, payloadOptions);
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

function addEvaluationPayload<Input, Output, Score, Expected>(
  attributes: LogAttributes,
  args: EvalReportArgs<Input, Output, Score, Expected>,
  options: Pick<OtelEvalReporterOptions, "captureMaxBytes" | "transformInput" | "transformOutput">,
): void {
  const transformInput = options.transformInput ?? identity;
  const transformOutput = options.transformOutput ?? identity;
  const payload: Record<string, unknown> = {
    input: transformInput(args.case.input),
  };
  if (args.case.expected !== undefined) payload.expected = transformInput(args.case.expected);
  if (args.case.context !== undefined) payload.context = transformInput(args.case.context);
  if (args.case.retrievalContext !== undefined) {
    payload.retrievalContext = transformInput(args.case.retrievalContext);
  }
  if (args.output !== undefined) payload.output = transformOutput(args.output);

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    attributes["anvia.eval.payload.status"] = "serialization_error";
    return;
  }
  const maxBytes = options.captureMaxBytes;
  if (
    maxBytes !== undefined &&
    Number.isFinite(maxBytes) &&
    maxBytes > 0 &&
    new TextEncoder().encode(serialized).byteLength > Math.floor(maxBytes)
  ) {
    attributes["anvia.eval.payload.status"] = "size_limit";
    return;
  }
  attributes["anvia.eval.payload"] = serialized;
  attributes["anvia.eval.payload.status"] = "captured";
}

function identity(value: unknown): unknown {
  return value;
}

function emitRunStarted(logger: Logger, args: EvalRunStartArgs, includeMetadata: boolean): void {
  const attributes: LogAttributes = {
    "anvia.eval.run.id": args.run.id,
    "anvia.eval.run.status": "running",
    "anvia.eval.run.started_at": args.run.startedAt,
    "anvia.eval.suite.name": args.suiteName,
    "anvia.eval.run.case_count": args.caseCount,
    "anvia.eval.run.metric_names": args.metricNames,
  };
  addRunAttributes(attributes, args.run, includeMetadata);
  logger.emit({
    eventName: "anvia.eval.run.started",
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    attributes,
  });
}

function emitRunFinished(logger: Logger, args: EvalRunEndArgs, includeMetadata: boolean): void {
  const attributes: LogAttributes = {
    "anvia.eval.run.id": args.run.id,
    "anvia.eval.run.status": args.status,
    "anvia.eval.run.started_at": args.run.startedAt,
    "anvia.eval.run.completed_at": args.completedAt,
    "anvia.eval.run.duration_ms": args.durationMs,
    "anvia.eval.suite.name": args.suiteName,
    "anvia.eval.run.case_count": args.caseCount,
    "anvia.eval.run.metric_names": args.metricNames,
  };
  if (args.metrics !== undefined) {
    addTotals(attributes, "anvia.eval.run.metrics", args.metrics);
  }
  if (args.cases !== undefined) {
    addTotals(attributes, "anvia.eval.run.cases", args.cases);
  }
  if (args.usage !== undefined) {
    attributes["anvia.eval.run.usage.target_tokens"] = args.usage.target.totalTokens;
    attributes["anvia.eval.run.usage.evaluation_tokens"] = args.usage.evaluation.totalTokens;
    attributes["anvia.eval.run.usage.total_tokens"] = args.usage.total.totalTokens;
  }
  if (args.cost !== undefined) {
    attributes["anvia.eval.run.cost.currency"] = args.cost.currency;
    attributes["anvia.eval.run.cost.target"] = args.cost.target;
    attributes["anvia.eval.run.cost.evaluation"] = args.cost.evaluation;
    attributes["anvia.eval.run.cost.total"] = args.cost.total;
  }
  if (args.status === "failed") attributes["error.type"] = errorType(args.error);
  addRunAttributes(attributes, args.run, includeMetadata);
  logger.emit({
    eventName: "anvia.eval.run.finished",
    severityNumber: args.status === "failed" ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: args.status === "failed" ? "ERROR" : "INFO",
    attributes,
  });
}

function addTotals(
  attributes: LogAttributes,
  prefix: string,
  totals: { total: number; passed: number; failed: number; invalid: number },
): void {
  attributes[`${prefix}.total`] = totals.total;
  attributes[`${prefix}.passed`] = totals.passed;
  attributes[`${prefix}.failed`] = totals.failed;
  attributes[`${prefix}.invalid`] = totals.invalid;
}

function addRunAttributes(
  attributes: LogAttributes,
  run: EvalRunStartArgs["run"],
  includeMetadata: boolean,
): void {
  attributes["anvia.eval.run.id"] = run.id;
  attributes["anvia.eval.run.started_at"] = run.startedAt;
  if (run.datasetName !== undefined) attributes["anvia.eval.run.dataset.name"] = run.datasetName;
  if (run.datasetVersion !== undefined) {
    attributes["anvia.eval.run.dataset.version"] = run.datasetVersion;
  }
  if (includeMetadata) addMetadata(attributes, "anvia.eval.run.metadata", run.metadata);
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
