import type { JsonValue } from "@anvia/core/completion";
import {
  type EvalReportArgs,
  type EvalReporter,
  projectEvalOutcome,
  resolveEvalTraceRef,
} from "@anvia/core/evals";
import type { LangfuseEvalReporterOptions, LangfuseScoreArgs, LangfuseTracing } from "./types.js";

const DEFAULT_TRUNCATE_BYTES = 2048;

export function createLangfuseEvalReporter<Input = unknown, Output = unknown, Expected = unknown>(
  tracing: Pick<LangfuseTracing, "score">,
  options: LangfuseEvalReporterOptions = {},
): EvalReporter<Input, Output, Expected> {
  const onMissingTrace = options.onMissingTrace ?? (options.strict === true ? "throw" : "ignore");
  const truncateAt = options.truncateInputAt ?? DEFAULT_TRUNCATE_BYTES;
  const includeMessages = options.includeMessages ?? true;
  const includeContext = options.includeContext ?? false;

  return {
    async report(args) {
      if (args.outcome.outcome === "invalid" && options.publishInvalid !== true) {
        return;
      }

      const trace =
        args.trace ??
        resolveEvalTraceRef({
          output: args.output,
          input: args.case.input,
          metadata: args.case.metadata,
        });
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

      const projection = projectEvalOutcome(
        args.outcome,
        args.metric.dataType,
        args.metric.projectScore,
      );
      const metadata = buildScoreMetadata({
        args,
        truncateAt,
        includeMessages,
        includeContext,
      });
      const configId = resolveConfigId(args.metric);

      const score: LangfuseScoreArgs = {
        traceId: trace.traceId,
        name: args.metric.name,
        value: projection.value,
      };
      if (trace.observationId !== undefined) score.observationId = trace.observationId;
      if (args.metric.dataType !== undefined) score.dataType = args.metric.dataType;
      if (configId !== undefined) score.configId = configId;
      if (projection.explanation !== undefined) score.comment = projection.explanation;
      if (metadata !== undefined) score.metadata = metadata;
      await tracing.score(score);
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
  includeContext,
}: {
  args: EvalReportArgs<Input, Output, Score, Expected>;
  truncateAt: number;
  includeMessages: boolean;
  includeContext: boolean;
}): Record<string, JsonValue | undefined> | undefined {
  const merged: Record<string, JsonValue | undefined> = {
    suiteName: args.suiteName,
    caseId: args.case.id,
    outcome: args.outcome.outcome,
    required: args.metric.required ?? true,
  };
  if (args.metric.direction !== undefined) merged.scoreDirection = args.metric.direction;
  if (args.metric.threshold !== undefined) merged.threshold = args.metric.threshold;
  if (args.outcome.usage !== undefined) merged.evaluationUsage = { ...args.outcome.usage };
  mergeMetadata(merged, args.outcome.metadata);
  mergeMetadata(merged, args.metric.metadata);
  if (args.case.metadata !== undefined) {
    merged.caseMetadata = { ...args.case.metadata };
  }
  if (includeContext && args.case.context !== undefined) {
    merged.context = [...args.case.context];
  }
  if (includeContext && args.case.retrievalContext !== undefined) {
    merged.retrievalContext = [...args.case.retrievalContext];
  }
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
