import { trace } from "@opentelemetry/api";
import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { describe, expect, it, vi } from "vitest";
import { createOtelScorer } from "../src/index";

describe("OpenTelemetry scorer", () => {
  it("emits correlated end-user feedback with stable identity and metadata", () => {
    const emit = vi.fn<Logger["emit"]>();
    const scorer = createOtelScorer({ logger: fakeLogger(emit) });
    const traceId = "1234567890abcdef1234567890abcdef";
    const observationId = "1234567890abcdef";

    scorer.score({
      id: "feedback-1",
      traceId,
      observationId,
      responseId: "response-1",
      name: "user-feedback",
      value: 0,
      dataType: "BOOLEAN",
      source: "end_user",
      comment: "The answer missed the requested detail.",
      metadata: { channel: "thumbs", userIdHash: "sha256:abc" },
    });

    expect(emit).toHaveBeenCalledOnce();
    const record = emit.mock.calls[0]?.[0] as Parameters<Logger["emit"]>[0];
    expect(record).toMatchObject({
      eventName: "gen_ai.evaluation.result",
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      attributes: {
        "anvia.eval.id": "feedback-1",
        "anvia.eval.suite.name": "production-feedback",
        "anvia.eval.outcome": "fail",
        "anvia.eval.source": "end_user",
        "anvia.eval.target.trace_id": traceId,
        "anvia.eval.target.observation_id": observationId,
        "anvia.eval.data_type": "BOOLEAN",
        "anvia.eval.score.metadata": { channel: "thumbs", userIdHash: "sha256:abc" },
        "gen_ai.evaluation.name": "user-feedback",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.score.value": 0,
        "gen_ai.evaluation.explanation": "The answer missed the requested detail.",
        "gen_ai.response.id": "response-1",
      },
    });
    expect(trace.getSpanContext(record.context!)).toMatchObject({ traceId, spanId: observationId });
  });

  it("emits a trace-correlated categorical score without requiring an observation", () => {
    const emit = vi.fn<Logger["emit"]>();
    const scorer = createOtelScorer({ logger: fakeLogger(emit) });

    scorer.score({
      traceId: "1234567890abcdef1234567890abcdef",
      name: "sentiment",
      value: "positive",
      dataType: "CATEGORICAL",
    });

    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      attributes: {
        "anvia.eval.outcome": "unknown",
        "gen_ai.evaluation.score.label": "positive",
      },
    });
    expect(emit.mock.calls[0]?.[0].context).toBeUndefined();
  });

  it("validates correlation identifiers and typed score values", () => {
    const scorer = createOtelScorer({ logger: fakeLogger(vi.fn()) });
    const valid = {
      traceId: "1234567890abcdef1234567890abcdef",
      name: "user-feedback",
    } as const;

    expect(() => scorer.score({ ...valid, value: 2, dataType: "BOOLEAN" })).toThrow(/BOOLEAN/);
    expect(() => scorer.score({ ...valid, value: "high", dataType: "NUMERIC" })).toThrow(/NUMERIC/);
    expect(() => scorer.score({ ...valid, value: 1, observationId: "invalid" })).toThrow(
      /observationId/,
    );
    expect(() => scorer.score({ ...valid, value: 1, traceId: "invalid" })).toThrow(/traceId/);
    expect(() => scorer.score({ ...valid, value: Number.NaN })).toThrow(/finite/);
    expect(() => scorer.score({ ...valid, value: 1, comment: "x".repeat(2_001) })).toThrow(
      /at most 2000 characters/,
    );
  });
});

function fakeLogger(emit: Logger["emit"]): Logger {
  return {
    emit: (record) => emit(record),
    enabled: () => true,
  };
}
