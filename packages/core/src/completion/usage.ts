/**
 * Provider-normalized, mutually exclusive usage buckets.
 *
 * Every token should appear in exactly one non-total bucket. `total` is the
 * only aggregate key and should equal the sum of the other buckets.
 */
export type UsageDetails = Record<string, number>;

/**
 * Token usage for one or more generations.
 *
 * `cachedInputTokens` counts input tokens served from the provider's prompt
 * cache; `cacheCreationInputTokens` counts input tokens billed for writing to
 * that cache. Both are subsets of `inputTokens`.
 */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  details?: UsageDetails;
};

/** Model context window bounds; unset input/output caps fall back to the window. */
export type ModelContextLimits = {
  contextWindow: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

/** Identifies a model together with its context limits. */
export type CompletionModelInfo = {
  modelId: string;
  context: ModelContextLimits;
};

/** Snapshot of how much of a model's context window a request consumed. */
export type ContextUsage = {
  model: CompletionModelInfo;
  usedTokens: number;
  remainingTokens: number;
  usedPercent: number;
  remainingPercent: number;
};

/** Computes context usage, or undefined when the model or usage data is unusable. */
export function calculateContextUsage(
  usage: Usage,
  model: CompletionModelInfo | undefined,
): ContextUsage | undefined {
  if (
    model === undefined ||
    !Number.isFinite(usage.inputTokens) ||
    usage.inputTokens <= 0 ||
    !Number.isFinite(model.context.contextWindow) ||
    model.context.contextWindow <= 0
  ) {
    return undefined;
  }

  const usedTokens = Math.max(0, usage.inputTokens);
  const remainingTokens = Math.max(0, model.context.contextWindow - usedTokens);
  const usedPercent = Math.min(100, (usedTokens / model.context.contextWindow) * 100);
  return {
    model,
    usedTokens,
    remainingTokens,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}

/** Resolves a model's context limits: explicit override wins over catalog lookup. */
export function resolveModelContextLimits(
  modelId: string,
  catalog: Readonly<Record<string, ModelContextLimits>>,
  override?: ModelContextLimits,
): ModelContextLimits | undefined {
  return override ?? catalog[modelId];
}

/**
 * Helpers for constructing and combining token usage.
 */
export const Usage = {
  /** Returns an all-zero usage value. */
  empty(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  },
  /**
   * Sums two usage values bucket by bucket. `details` are merged only when
   * both sides carry them; if either side omits them, the result omits them.
   */
  add(left: Usage, right: Usage): Usage {
    const result: Usage = {
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
      cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    };
    const details = addUsageDetails(left, right);

    if (details !== undefined) {
      result.details = details;
    }

    return result;
  },
  /** Returns true when every bucket, including `details`, is zero. */
  isEmpty(usage: Usage): boolean {
    return (
      isEmptyUsage(usage) &&
      (usage.details === undefined || Object.values(usage.details).every((value) => value === 0))
    );
  },
};

function addUsageDetails(left: Usage, right: Usage): UsageDetails | undefined {
  if (isEmptyUsage(left) && left.details === undefined) {
    return right.details === undefined ? undefined : { ...right.details };
  }

  if (isEmptyUsage(right) && right.details === undefined) {
    return left.details === undefined ? undefined : { ...left.details };
  }

  if (left.details === undefined || right.details === undefined) {
    return undefined;
  }

  const details: UsageDetails = { ...left.details };
  for (const [key, value] of Object.entries(right.details)) {
    details[key] = (details[key] ?? 0) + value;
  }
  return details;
}

function isEmptyUsage(usage: Usage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.totalTokens === 0 &&
    usage.cachedInputTokens === 0 &&
    usage.cacheCreationInputTokens === 0
  );
}
