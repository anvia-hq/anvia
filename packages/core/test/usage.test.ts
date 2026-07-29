import { describe, expect, it } from "vitest";
import { Usage } from "../src/completion";

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
