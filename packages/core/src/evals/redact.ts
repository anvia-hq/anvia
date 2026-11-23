import type { EvalSuiteResult } from "./types";

export type EvalRedactionContext = {
  kind:
    | "input"
    | "expected"
    | "context"
    | "retrievalContext"
    | "output"
    | "score"
    | "comment"
    | "metadata"
    | "error";
  caseId?: string | undefined;
  metricName?: string | undefined;
};

export type EvalRedactor = (value: unknown, context: EvalRedactionContext) => unknown;

export type EvalSerializeOptions = {
  maxValueLength?: number | undefined;
  redact?: EvalRedactor | undefined;
};

export function validateMaxValueLength(maxValueLength: number | undefined): void {
  if (
    maxValueLength !== undefined &&
    (!Number.isSafeInteger(maxValueLength) || maxValueLength < 1)
  ) {
    throw new RangeError("Evaluation maxValueLength must be a positive integer.");
  }
}

export function truncateEvalString(value: string, maxValueLength: number | undefined): string {
  return maxValueLength !== undefined && value.length > maxValueLength
    ? `${value.slice(0, maxValueLength)}…`
    : value;
}

export function redactEvalValue(
  value: unknown,
  redactor: EvalRedactor | undefined,
  context: EvalRedactionContext,
): unknown {
  return redactor === undefined ? value : redactor(value, context);
}

const PRESERVED_JSON_KEYS = new Set([
  "id",
  "name",
  "metricName",
  "outcome",
  "targetStatus",
  "direction",
  "currency",
  "startedAt",
  "cachedAt",
  "kind",
]);

export function serializeEvalResultJson(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: EvalSerializeOptions = {},
): string {
  validateMaxValueLength(options.maxValueLength);
  return JSON.stringify(
    redactEvalResult(result, options.redact),
    (key, value: unknown) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }

      if (value instanceof RegExp) return String(value);

      if (typeof value === "string" && !PRESERVED_JSON_KEYS.has(key)) {
        return truncateEvalString(value, options.maxValueLength);
      }

      return value;
    },
    2,
  );
}

export function redactEvalResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  redactor: EvalRedactor | undefined,
): unknown {
  return {
    ...result,
    run: {
      ...result.run,
      metadata:
        result.run.metadata === undefined
          ? undefined
          : (redactEvalValue(result.run.metadata, redactor, {
              kind: "metadata",
            }) as typeof result.run.metadata),
    },
    results: result.results.map((caseResult) => {
      const caseId = caseResult.case.id;
      const redactedCase: Record<string, unknown> = {
        ...caseResult,
        case: {
          ...caseResult.case,
          input: redactEvalValue(caseResult.case.input, redactor, {
            kind: "input",
            caseId,
          }),
          expected: redactEvalValue(caseResult.case.expected, redactor, {
            kind: "expected",
            caseId,
          }),
          context: redactEvalValue(caseResult.case.context, redactor, {
            kind: "context",
            caseId,
          }),
          retrievalContext: redactEvalValue(caseResult.case.retrievalContext, redactor, {
            kind: "retrievalContext",
            caseId,
          }),
          metadata:
            caseResult.case.metadata === undefined
              ? undefined
              : (redactEvalValue(caseResult.case.metadata, redactor, {
                  kind: "metadata",
                  caseId,
                }) as typeof caseResult.case.metadata),
        },
        output:
          caseResult.targetStatus === "succeeded"
            ? redactEvalValue(caseResult.output, redactor, { kind: "output", caseId })
            : undefined,
        targetError:
          caseResult.targetStatus === "failed"
            ? redactEvalValue(caseResult.targetError, redactor, {
                kind: "error",
                caseId,
              })
            : undefined,
        metrics: caseResult.metrics.map((metric) => redactMetricResult(metric, redactor, caseId)),
        scores: Object.fromEntries(
          caseResult.metrics.map((metric) => [
            metric.metricName,
            redactOutcome(metric.outcome, redactor, caseId, metric.metricName),
          ]),
        ),
      };

      if (caseResult.trials !== undefined) {
        redactedCase.trials = {
          ...caseResult.trials,
          runs: caseResult.trials.runs.map((trialRun) => ({
            ...trialRun,
            output:
              trialRun.targetStatus === "succeeded"
                ? redactEvalValue(trialRun.output, redactor, { kind: "output", caseId })
                : undefined,
            targetError:
              trialRun.targetStatus === "failed"
                ? redactEvalValue(trialRun.targetError, redactor, { kind: "error", caseId })
                : undefined,
            metrics: trialRun.metrics.map((metric) => redactMetricResult(metric, redactor, caseId)),
          })),
        };
      }

      return redactedCase;
    }),
    reporterErrors: result.reporterErrors.map((error) =>
      redactEvalValue(error, redactor, { kind: "error" }),
    ),
  };
}

function redactMetricResult(
  metric: EvalSuiteResult<unknown, unknown, unknown>["results"][number]["metrics"][number],
  redactor: EvalRedactor | undefined,
  caseId: string,
): unknown {
  return {
    ...metric,
    reporterErrors: metric.reporterErrors.map((error) =>
      redactEvalValue(error, redactor, {
        kind: "error",
        caseId,
        metricName: metric.metricName,
      }),
    ),
    outcome: redactOutcome(metric.outcome, redactor, caseId, metric.metricName),
  };
}

function redactOutcome(
  outcome: EvalSuiteResult<
    unknown,
    unknown,
    unknown
  >["results"][number]["metrics"][number]["outcome"],
  redactor: EvalRedactor | undefined,
  caseId: string,
  metricName: string,
): unknown {
  const redacted: Record<string, unknown> = { ...outcome };

  if (outcome.score !== undefined) {
    redacted.score = redactEvalValue(outcome.score, redactor, {
      kind: "score",
      caseId,
      metricName,
    });
  }

  if (outcome.comment !== undefined) {
    redacted.comment = redactEvalValue(outcome.comment, redactor, {
      kind: "comment",
      caseId,
      metricName,
    });
  }

  if ("reason" in outcome && outcome.reason !== undefined) {
    redacted.reason = redactEvalValue(outcome.reason, redactor, {
      kind: "comment",
      caseId,
      metricName,
    });
  }

  if (outcome.metadata !== undefined) {
    redacted.metadata = redactEvalValue(outcome.metadata, redactor, {
      kind: "metadata",
      caseId,
      metricName,
    });
  }

  if ("error" in outcome && outcome.error !== undefined) {
    redacted.error = redactEvalValue(outcome.error, redactor, {
      kind: "error",
      caseId,
      metricName,
    });
  }

  return redacted;
}
