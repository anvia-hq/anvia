import { createMemoryEvalCache, EvalOutcome, exactMatch, runEvalSuite } from "@anvia/core/evals";
import type { Logger } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { createOtelEvalReporter } from "../src/index";

describe("OpenTelemetry eval reporter DX attributes", () => {
  it("emits case tags, metric model identity, trial numbers, cache flags, and run passed status", async () => {
    const emit = vi.fn<Logger["emit"]>();
    const logger: Logger = {
      emit: (record) => emit(record),
      enabled: () => true,
    };
    const reporter = createOtelEvalReporter({ logger });
    const cache = createMemoryEvalCache<string, string>();

    const metric = {
      name: "judge_check",
      model: { provider: "openai", modelId: "gpt-5.5" },
      evaluate: () => EvalOutcome.pass(1),
    };

    const result = await runEvalSuite({
      name: "dx-otel",
      cases: [{ id: "c1", input: "ok", expected: "ok", tags: ["smoke", "billing"] }],
      target: (input) => input,
      metrics: [exactMatch(), metric],
      trials: 2,
      reporters: [reporter],
    });

    expect(result.passed).toBe(true);
    const records = emit.mock.calls.map((call) => call[0]);
    const evalRecords = records.filter((record) => record.eventName === "gen_ai.evaluation.result");
    expect(evalRecords).toHaveLength(4);
    expect(evalRecords[0]?.attributes).toMatchObject({
      "anvia.eval.case.tags": ["smoke", "billing"],
      "anvia.eval.trial": 1,
      "anvia.eval.trial_count": 2,
    });
    expect(evalRecords[1]?.attributes).toMatchObject({
      "anvia.eval.metric.provider": "openai",
      "anvia.eval.metric.model": "gpt-5.5",
      "anvia.eval.trial": 1,
      "anvia.eval.trial_count": 2,
    });
    expect(evalRecords[2]?.attributes).toMatchObject({
      "anvia.eval.trial": 2,
      "anvia.eval.trial_count": 2,
    });

    const finishedRecord = records.find((record) => record.eventName === "anvia.eval.run.finished");
    expect(finishedRecord?.attributes).toMatchObject({
      "anvia.eval.run.passed": true,
    });

    emit.mockClear();
    await runEvalSuite({
      name: "dx-otel-cache",
      cases: [{ id: "c1", input: "ok", expected: "ok" }],
      target: (input) => input,
      metrics: [exactMatch()],
      targetCache: cache,
      reporters: [reporter],
    });
    await runEvalSuite({
      name: "dx-otel-cache",
      cases: [{ id: "c1", input: "ok", expected: "ok" }],
      target: (input) => input,
      metrics: [exactMatch()],
      targetCache: cache,
      reporters: [reporter],
    });

    const cachedRecords = emit.mock.calls
      .map((call) => call[0])
      .filter((record) => record.eventName === "gen_ai.evaluation.result");
    expect(cachedRecords[0]?.attributes?.["anvia.eval.cached"]).toBeUndefined();
    expect(cachedRecords[1]?.attributes?.["anvia.eval.cached"]).toBe(true);
  });
});
