import { createMemoryEvalCache, EvalOutcome, exactMatch, runEvalSuite } from "@anvia/core/evals";
import { describe, expect, it, vi } from "vitest";
import { createLangfuseEvalReporter } from "../src/eval-reporter.js";
import { runLangfuseEvalExperiment } from "../src/experiment-runner.js";
import type { LangfuseDatasetClient, LangfuseScoreArgs } from "../src/index";

describe("Langfuse eval reporter and experiment runner DX", () => {
  it("forwards case tags, metric model identity, trial metadata, and cache flags to Langfuse scores", async () => {
    const scores: LangfuseScoreArgs[] = [];
    const reporter = createLangfuseEvalReporter({
      score: async (args) => {
        scores.push(args);
      },
    });
    const cache = createMemoryEvalCache<string, { output: string; trace: { traceId: string } }>();
    const metric = {
      name: "judge_quality",
      model: { provider: "anthropic", modelId: "claude-sonnet" },
      evaluate: () => EvalOutcome.pass(1),
    };

    await runEvalSuite({
      name: "langfuse-dx",
      cases: [{ id: "c1", input: "hi", expected: "hi", tags: ["smoke"] }],
      target: (input) => ({ output: input, trace: { traceId: "trace-1" } }),
      metrics: [metric],
      trials: 2,
      reporters: [reporter],
    });

    expect(scores).toHaveLength(2);
    expect(scores[0]?.metadata).toMatchObject({
      caseTags: ["smoke"],
      metricModel: { provider: "anthropic", modelId: "claude-sonnet" },
      trial: 1,
      trialCount: 2,
    });
    expect(scores[1]?.metadata).toMatchObject({
      trial: 2,
      trialCount: 2,
    });

    scores.length = 0;
    const cachedSuite = {
      name: "langfuse-cache",
      cases: [{ id: "c1", input: "hi", expected: "hi" }],
      target: (input: string) => ({ output: input, trace: { traceId: "trace-2" } }),
      metrics: [exactMatch()],
      targetCache: cache,
      reporters: [reporter],
    };
    await runEvalSuite(cachedSuite);
    await runEvalSuite(cachedSuite);
    expect(scores[0]?.metadata?.cached).toBeUndefined();
    expect(scores[1]?.metadata?.cached).toBe(true);
  });

  it("posts only filtered suite cases, resolves trace refs from metadata, and preserves metric score types", async () => {
    const runExperiment = vi.fn<LangfuseDatasetClient["runExperiment"]>(async (options) => {
      const results = [];
      for (const item of options.items ?? []) {
        results.push({ id: item.id, result: await options.run(item) });
      }
      return {
        runName: options.runName,
        datasetName: options.datasetName,
        posted: results.length,
        errors: [],
      };
    });

    const client = {
      score: vi.fn(async () => {}),
      datasetClient: () =>
        ({
          createDataset: vi.fn(),
          getDataset: vi.fn(),
          upsertItems: vi.fn(),
          runExperiment,
        }) as unknown as LangfuseDatasetClient,
    };

    const { suite, datasetRun } = await runLangfuseEvalExperiment(client, {
      suite: {
        name: "filtered-experiment",
        cases: [
          {
            id: "billing-1",
            input: "refund",
            expected: "REFUND",
            tags: ["billing"],
            metadata: { traceId: "trace-from-meta", observationId: "obs-1" },
          },
          {
            id: "other-1",
            input: "skip",
            expected: "SKIP",
            tags: ["general"],
          },
        ],
        tags: ["billing"],
        target: (input) => input.toUpperCase(),
        metrics: [exactMatch({ name: "upper_match" })],
      },
      experiment: {
        datasetName: "support",
        runName: "run-1",
        publishScores: true,
      },
    });

    expect(suite.passed).toBe(true);
    expect(suite.results[0]?.scores.upper_match.outcome).toBe("pass");
    expect(datasetRun.posted).toBe(1);

    const runArgs = runExperiment.mock.calls[0]?.[0];
    expect(runArgs?.items?.map((item) => item.id)).toEqual(["billing-1"]);
    expect(runArgs?.items?.[0]?.tags).toEqual(["billing"]);
    expect(runArgs?.items?.[0]?.metadata).toMatchObject({
      traceId: "trace-from-meta",
      tags: ["billing"],
    });

    const resolvedItem = await runArgs?.run(runArgs.items![0]!);
    expect(resolvedItem).toEqual({
      output: "REFUND",
      trace: { traceId: "trace-from-meta", observationId: "obs-1" },
    });
  });
});
