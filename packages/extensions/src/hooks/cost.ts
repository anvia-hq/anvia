import type { AgentLifecycle } from "@anvia/core/agent";
import type { Usage } from "@anvia/core/completion";

export type TokenPricing = {
  /** Cost per 1,000,000 uncached input tokens. */
  inputPerMillion: number;
  /** Cost per 1,000,000 output tokens. */
  outputPerMillion: number;
  /** Cost per 1,000,000 cached input tokens. Defaults to `inputPerMillion`. */
  cachedInputPerMillion?: number | undefined;
  /** Cost per 1,000,000 cache-creation input tokens. Defaults to `inputPerMillion`. */
  cacheCreationInputPerMillion?: number | undefined;
};

export type CostBreakdown = {
  uncachedInputCost: number;
  cachedInputCost: number;
  cacheCreationInputCost: number;
  outputCost: number;
  totalCost: number;
};

export type CostReportStatus = "in_progress" | "completed" | "blocked" | "suspended" | "error";

export type CostReport = {
  runId: string;
  status: CostReportStatus;
  currency: string;
  usage: Usage;
  cost: CostBreakdown;
  budgetExceeded: boolean;
};

export type CostHookOptions = {
  /** Token pricing rates per million tokens. */
  pricing: TokenPricing;
  /** Callback invoked once when a run finishes or errors. */
  onCost: (report: CostReport) => void | Promise<void>;
  /** Optional currency code label. Default `"USD"`. */
  currency?: string | undefined;
  /** Optional per-run budget threshold; triggers `onBudgetExceeded` once when crossed. */
  budget?: number | undefined;
  /** Optional callback fired once per run when cumulative estimated cost exceeds `budget`. */
  onBudgetExceeded?: ((report: CostReport) => void | Promise<void>) | undefined;
};

const MAX_TRACKED_RUNS = 256;

export function calculateUsageCost(usage: Usage, pricing: TokenPricing): CostBreakdown {
  validatePricing(pricing);

  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const cacheCreateRate = pricing.cacheCreationInputPerMillion ?? pricing.inputPerMillion;
  const totalInputTokens = safeTokenCount(usage.inputTokens);
  const cachedTokens = safeTokenCount(usage.cachedInputTokens);
  const cacheCreationTokens = safeTokenCount(usage.cacheCreationInputTokens);
  const uncachedInputTokens = Math.max(0, totalInputTokens - cachedTokens - cacheCreationTokens);
  const outputTokens = safeTokenCount(usage.outputTokens);

  const uncachedInputCost = (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * cachedRate;
  const cacheCreationInputCost = (cacheCreationTokens / 1_000_000) * cacheCreateRate;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = uncachedInputCost + cachedInputCost + cacheCreationInputCost + outputCost;

  return {
    uncachedInputCost,
    cachedInputCost,
    cacheCreationInputCost,
    outputCost,
    totalCost,
  };
}

export function costHook<Output = unknown, RawResponse = unknown>(
  options: CostHookOptions,
): AgentLifecycle<Output, RawResponse> {
  const pricing: TokenPricing = { ...options.pricing };
  validatePricing(pricing);

  if (options.budget !== undefined && (!Number.isFinite(options.budget) || options.budget < 0)) {
    throw new RangeError("costHook budget must be a non-negative finite number.");
  }

  const currency = options.currency ?? "USD";
  const budgetAlertedRuns = new Set<string>();
  const reportedRuns = new Set<string>();

  const remember = (set: Set<string>, runId: string): void => {
    set.add(runId);

    if (set.size > MAX_TRACKED_RUNS) {
      const oldest = set.values().next().value;

      if (oldest !== undefined) set.delete(oldest);
    }
  };

  const buildReport = (runId: string, status: CostReportStatus, usage: Usage): CostReport => {
    const cost = calculateUsageCost(usage, pricing);
    const budgetExceeded = options.budget !== undefined && cost.totalCost > options.budget;
    return {
      runId,
      status,
      currency,
      usage: cloneUsage(usage),
      cost,
      budgetExceeded,
    };
  };

  const maybeNotifyBudget = async (report: CostReport): Promise<void> => {
    if (
      report.budgetExceeded &&
      options.onBudgetExceeded !== undefined &&
      !budgetAlertedRuns.has(report.runId)
    ) {
      remember(budgetAlertedRuns, report.runId);
      await options.onBudgetExceeded(report);
    }
  };

  return {
    onStart(event) {
      reportedRuns.delete(event.runId);
      budgetAlertedRuns.delete(event.runId);
    },
    async onStepFinish(event) {
      if (options.budget !== undefined && options.onBudgetExceeded !== undefined) {
        const report = buildReport(event.runId, "in_progress", event.usage);
        await maybeNotifyBudget(report);
      }
    },
    async onFinish(event) {
      if (reportedRuns.has(event.runId)) {
        return;
      }

      const report = buildReport(event.runId, event.status, event.usage);
      await maybeNotifyBudget(report);
      budgetAlertedRuns.delete(event.runId);
      remember(reportedRuns, event.runId);
      await options.onCost(report);
    },
    async onError(event) {
      if (reportedRuns.has(event.runId)) {
        return;
      }

      const report = buildReport(event.runId, "error", event.usage);
      await maybeNotifyBudget(report);
      budgetAlertedRuns.delete(event.runId);
      remember(reportedRuns, event.runId);
      await options.onCost(report);
    },
  };
}

function safeTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function cloneUsage(usage: Usage): Usage {
  if (usage.details !== undefined) {
    return { ...usage, details: { ...usage.details } };
  }

  return { ...usage };
}

function validatePricing(pricing: TokenPricing): void {
  const rates: [string, number | undefined][] = [
    ["inputPerMillion", pricing.inputPerMillion],
    ["outputPerMillion", pricing.outputPerMillion],
    ["cachedInputPerMillion", pricing.cachedInputPerMillion],
    ["cacheCreationInputPerMillion", pricing.cacheCreationInputPerMillion],
  ];

  for (const [label, value] of rates) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`TokenPricing ${label} must be a non-negative finite number.`);
    }
  }
}
