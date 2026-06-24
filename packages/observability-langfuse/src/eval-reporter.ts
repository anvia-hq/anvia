import type { JsonValue } from "@anvia/core/completion";
import type { EvalOutcome, EvalReportArgs, EvalReporter } from "@anvia/core/evals";
import type { AgentTraceInfo } from "@anvia/core/observability";
import type {
  LangfuseEvalReporterOptions,
  LangfuseScoreDataType,
  LangfuseTracing,
} from "./types.js";

const DEFAULT_TRUNCATE_BYTES = 2048;

export function createLangfuseEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: Pick<LangfuseTracing, "score">,
  options: LangfuseEvalReporterOptions = {},
): EvalReporter<Input, Output, Expected> {
  const onMissingTrace = options.onMissingTrace ?? (options.strict === true ? "throw" : "ignore");
  const truncateAt = options.truncateInputAt ?? DEFAULT_TRUNCATE_BYTES;
  const includeMessages = options.includeMessages ?? true;

  return {
    async report(args) {
      if (args.outcome.outcome === "invalid" && options.publishInvalid !== true) {
        return;
      }

      const trace = traceFromEvalReport(args);
      if (trace?.traceId === undefined || trace.traceId.length === 0) {
        if (onMissingTrace === "throw") {
          throw new Error("Langfuse eval reporter requires traceId");
        }
        if (onMissingTrace === "warn") {
          // eslint-disable-next-line no-console
          console.warn(
            "[anvia/langfuse] eval reporter dropped score because no traceId was found",
            { caseId: args.case.id, metric: args.metric.name },
          );
        }
        return;
      }

      const scoreValue = buildScoreValue(args.outcome, args.metric.dataType);
      const metadata = buildScoreMetadata({
        args,
        truncateAt,
        includeMessages,
      });
      const comment = scoreComment(args.outcome);

      await tracing.score({
        traceId: trace.traceId,
        ...(trace.observationId === undefined ? {} : { observationId: trace.observationId }),
        name: args.metric.name,
        value: scoreValue,
        ...(args.metric.dataType === undefined ? {} : { dataType: args.metric.dataType }),
        ...(resolveConfigId(args.metric) === undefined
          ? {}
          : { configId: resolveConfigId(args.metric) as string }),
        ...(comment === undefined ? {} : { comment }),
        ...(metadata === undefined ? {} : { metadata }),
      });
    },
  };
}

function resolveConfigId(metric: {
  scoreConfigId?: string | undefined;
  configId?: string | undefined;
}): string | undefined {
  return metric.configId ?? metric.scoreConfigId;
}

function buildScoreMetadata<Input, Output, Score, Expected>({
  args,
  truncateAt,
  includeMessages,
}: {
  args: EvalReportArgs<Input, Output, Score, Expected>;
  truncateAt: number;
  includeMessages: boolean;
}): Record<string, JsonValue | undefined> | undefined {
  const merged: Record<string, JsonValue | undefined> = {
    suiteName: args.suiteName,
    caseId: args.case.id,
    outcome: args.outcome.outcome,
  };
  mergeMetadata(merged, args.outcome.metadata);
  mergeMetadata(merged, args.metric.metadata);
  const inputSummary = truncateValue(args.case.input, truncateAt);
  if (inputSummary !== undefined) {
    merged.caseInputSummary = inputSummary;
  }
  if (args.case.expected !== undefined) {
    const expectedSummary = truncateValue(args.case.expected, truncateAt);
    if (expectedSummary !== undefined) {
      merged.caseExpectedSummary = expectedSummary;
    }
  }
  if (includeMessages) {
    const messages = readMessages(args.output);
    if (messages !== undefined) {
      merged.messages = messages;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeMetadata(
  target: Record<string, JsonValue | undefined>,
  source: Record<string, JsonValue | undefined> | undefined,
): void {
  if (source === undefined) return;
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function truncateValue(value: unknown, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (serialized === undefined) return undefined;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(serialized);
  if (bytes.length <= maxBytes) {
    return serialized;
  }
  // Truncate at byte boundary by slicing, then append the marker.
  const truncatedBytes = bytes.subarray(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return `${decoder.decode(truncatedBytes)}<truncated>`;
}

function readMessages(output: unknown): JsonValue[] | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const messages = (output as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return undefined;
  const serialized: JsonValue[] = [];
  for (const entry of messages) {
    if (entry === null || typeof entry !== "object") return undefined;
    try {
      // Round-trip via JSON to make sure we never put non-JSON values
      // into a JsonValue-typed slot.
      serialized.push(JSON.parse(JSON.stringify(entry)) as JsonValue);
    } catch {
      return undefined;
    }
  }
  return serialized;
}

function buildScoreValue(
  outcome: EvalOutcome,
  dataType: LangfuseScoreDataType | undefined,
): number | string {
  if (dataType === "CATEGORICAL") {
    const score = (outcome as { score?: unknown }).score;
    if (typeof score === "string") return score;
    if (typeof score === "number") return String(score);
    if (typeof score === "boolean") return score ? "true" : "false";
    if (score === null || score === undefined) {
      return outcome.outcome === "pass" ? "pass" : outcome.outcome === "fail" ? "fail" : "invalid";
    }
    try {
      return JSON.stringify(score);
    } catch {
      return outcome.outcome === "pass" ? "pass" : outcome.outcome;
    }
  }
  if (dataType === "BOOLEAN") {
    const score = (outcome as { score?: unknown }).score;
    if (typeof score === "boolean") return score ? 1 : 0;
    if (typeof score === "number") return score === 0 ? 0 : 1;
    return outcome.outcome === "pass" ? 1 : 0;
  }
  // Numeric (default)
  if (typeof (outcome as { score?: unknown }).score === "number") {
    return (outcome as { score: number }).score;
  }
  if (typeof (outcome as { score?: unknown }).score === "boolean") {
    return (outcome as { score: boolean }).score ? 1 : 0;
  }
  if (
    typeof (outcome as { score?: unknown }).score === "object" &&
    (outcome as { score?: unknown }).score !== null &&
    "score" in ((outcome as { score?: unknown }).score as object) &&
    typeof ((outcome as { score?: unknown }).score as { score?: unknown }).score === "number"
  ) {
    return (outcome as { score: { score: number } }).score.score;
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
  const inputTrace = traceFromInput(args.case.input);
  if (inputTrace !== undefined) {
    return inputTrace;
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
  return readTrace((output as { trace?: unknown }).trace);
}

function traceFromInput(input: unknown): AgentTraceInfo | undefined {
  if (typeof input !== "object" || input === null || !("trace" in input)) {
    return undefined;
  }
  return readTrace((input as { trace?: unknown }).trace);
}

function readTrace(trace: unknown): AgentTraceInfo | undefined {
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
