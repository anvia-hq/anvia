import { Usage } from "@anvia/core/completion";

export function normalizeOpenAIUsage(options: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
}): Usage {
  const inputTokens = Math.max(0, options.inputTokens);
  const outputTokens = Math.max(0, options.outputTokens);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, options.cachedInputTokens));
  const reasoningOutputTokens = Math.min(outputTokens, Math.max(0, options.reasoningOutputTokens));
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    details: {
      input: inputTokens - cachedInputTokens,
      input_cached_tokens: cachedInputTokens,
      output: outputTokens - reasoningOutputTokens,
      output_reasoning_tokens: reasoningOutputTokens,
      total: totalTokens,
    },
  };
}
