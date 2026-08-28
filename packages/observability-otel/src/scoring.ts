import { logs, SeverityNumber, type LogAttributes, type Logger } from "@opentelemetry/api-logs";
import { addMetadata, contextFromTraceRef, EVALUATION_EVENT_NAME } from "./evaluation-logging.js";
import { isValidSpanId, isValidTraceId } from "./helpers.js";
import type { OtelScoreArgs, OtelScorer, OtelScorerOptions } from "./types.js";

const MAX_SCORE_COMMENT_LENGTH = 2_000;

export function createOtelScorer(options: OtelScorerOptions = {}): OtelScorer {
  const logger =
    options.logger ?? logs.getLogger(options.loggerName ?? "@anvia/otel", options.loggerVersion);
  return {
    score(args) {
      validateScore(args);
      emitScore(logger, args);
    },
  };
}

function emitScore(logger: Logger, args: OtelScoreArgs): void {
  const outcome = args.outcome ?? inferOutcome(args);
  const attributes: LogAttributes = {
    "anvia.eval.id": args.id ?? globalThis.crypto.randomUUID(),
    "anvia.eval.suite.name": args.suiteName ?? defaultSuiteName(args),
    "anvia.eval.outcome": outcome,
    "anvia.eval.target.trace_id": args.traceId,
    "gen_ai.evaluation.name": args.name,
    "gen_ai.evaluation.score.label": args.label ?? scoreLabel(args, outcome),
  };
  if (typeof args.value === "number") {
    attributes["gen_ai.evaluation.score.value"] = args.value;
  }
  if (args.observationId !== undefined) {
    attributes["anvia.eval.target.observation_id"] = args.observationId;
  }
  if (args.responseId !== undefined) attributes["gen_ai.response.id"] = args.responseId;
  if (args.dataType !== undefined) attributes["anvia.eval.data_type"] = args.dataType;
  if (args.comment !== undefined) attributes["gen_ai.evaluation.explanation"] = args.comment;
  if (args.configId !== undefined) attributes["anvia.eval.config_id"] = args.configId;
  if (args.source !== undefined) attributes["anvia.eval.source"] = args.source;
  addMetadata(attributes, "anvia.eval.score.metadata", args.metadata);

  const record: Parameters<Logger["emit"]>[0] = {
    eventName: EVALUATION_EVENT_NAME,
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    attributes,
  };
  const context = contextFromTraceRef(args);
  if (context !== undefined) record.context = context;
  logger.emit(record);
}

function validateScore(args: OtelScoreArgs): void {
  if (!isValidTraceId(args.traceId)) {
    throw new TypeError("OpenTelemetry score requires a valid 32-character traceId");
  }
  if (args.observationId !== undefined && !isValidSpanId(args.observationId)) {
    throw new TypeError("OpenTelemetry score observationId must be a valid 16-character span ID");
  }
  if (args.name.trim().length === 0) {
    throw new TypeError("OpenTelemetry score requires a non-empty name");
  }
  if (args.id !== undefined && args.id.trim().length === 0) {
    throw new TypeError("OpenTelemetry score id must not be empty");
  }
  if (args.comment !== undefined && args.comment.length > MAX_SCORE_COMMENT_LENGTH) {
    throw new TypeError(
      `OpenTelemetry score comment must be at most ${MAX_SCORE_COMMENT_LENGTH} characters`,
    );
  }
  if (typeof args.value === "number" && !Number.isFinite(args.value)) {
    throw new TypeError("OpenTelemetry score value must be finite");
  }
  if (args.dataType === "NUMERIC" && typeof args.value !== "number") {
    throw new TypeError("OpenTelemetry score dataType=NUMERIC requires a number value");
  }
  if (args.dataType === "CATEGORICAL" && typeof args.value !== "string") {
    throw new TypeError("OpenTelemetry score dataType=CATEGORICAL requires a string value");
  }
  if (args.dataType === "BOOLEAN" && args.value !== 0 && args.value !== 1) {
    throw new TypeError("OpenTelemetry score dataType=BOOLEAN requires value 0 or 1");
  }
}

function inferOutcome(args: OtelScoreArgs): NonNullable<OtelScoreArgs["outcome"]> {
  if (args.dataType === "BOOLEAN") return args.value === 1 ? "pass" : "fail";
  if (typeof args.value === "string") {
    const normalized = args.value.toLowerCase();
    if (normalized === "pass" || normalized === "fail" || normalized === "invalid") {
      return normalized;
    }
  }
  return "unknown";
}

function scoreLabel(args: OtelScoreArgs, outcome: NonNullable<OtelScoreArgs["outcome"]>): string {
  return typeof args.value === "string" ? args.value : outcome;
}

function defaultSuiteName(args: OtelScoreArgs): string {
  return args.source === "end_user" ? "production-feedback" : "production-score";
}
