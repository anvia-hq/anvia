import { describe, expect, it } from "vitest";
import {
  calculateContextUsage,
  resolveCompletionModelInfo,
  Usage,
  withContextUsage,
} from "../src/completion";

describe("Usage", () => {
  it("adds complete mutually exclusive details", () => {
    const left = {
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 0,
      details: { input: 5, input_cached_tokens: 3, output: 2, total: 10 },
    };
    const right = {
      inputTokens: 4,
      outputTokens: 1,
      totalTokens: 5,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      details: { input: 4, input_cached_tokens: 0, output: 1, total: 5 },
    };

    expect(Usage.add(left, right)).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 0,
      details: { input: 9, input_cached_tokens: 3, output: 3, total: 15 },
    });
  });

  it("omits details when an aggregate contains an incomplete breakdown", () => {
    expect(
      Usage.add(
        {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          details: { input: 2, output: 1, total: 3 },
        },
        {
          inputTokens: 4,
          outputTokens: 1,
          totalTokens: 5,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ),
    ).not.toHaveProperty("details");
  });

  it("treats empty usage as an identity for details", () => {
    const usage = {
      inputTokens: 2,
      outputTokens: 1,
      totalTokens: 3,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      details: { input: 2, output: 1, total: 3 },
    };
    expect(Usage.add(Usage.empty(), usage)).toEqual(usage);
  });
});

describe("context usage", () => {
  const usage = {
    inputTokens: 60,
    outputTokens: 15,
    totalTokens: 75,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 0,
  };

  it("uses provider input tokens as raw context occupancy", () => {
    expect(
      calculateContextUsage(usage, {
        id: "model-a",
        context: { contextWindow: 100, maxInputTokens: 80, maxOutputTokens: 20 },
      }),
    ).toEqual({
      model: {
        id: "model-a",
        context: { contextWindow: 100, maxInputTokens: 80, maxOutputTokens: 20 },
      },
      usedTokens: 60,
      remainingTokens: 40,
      usedPercent: 60,
      remainingPercent: 40,
    });
  });

  it("clamps percentages while preserving over-limit token usage", () => {
    const contextUsage = calculateContextUsage(
      { ...usage, inputTokens: 125, totalTokens: 140 },
      { id: "model-a", context: { contextWindow: 100 } },
    );

    expect(contextUsage).toMatchObject({
      usedTokens: 125,
      remainingTokens: 0,
      usedPercent: 100,
      remainingPercent: 0,
    });
  });

  it("returns undefined without authoritative usage or model limits", () => {
    expect(calculateContextUsage(Usage.empty(), undefined)).toBeUndefined();
    expect(
      calculateContextUsage(Usage.empty(), {
        id: "model-a",
        context: { contextWindow: 100 },
      }),
    ).toBeUndefined();
  });

  it("resolves overrides before catalogs and decorates responses", () => {
    const info = resolveCompletionModelInfo(
      "custom",
      { custom: { contextWindow: 100 } },
      { custom: { contextWindow: 200 } },
    );
    const response = withContextUsage({ choice: [], usage, rawResponse: {} }, info);

    expect(response.contextUsage?.model.context.contextWindow).toBe(200);
    expect(resolveCompletionModelInfo("unknown", {})).toBeUndefined();
  });
});
