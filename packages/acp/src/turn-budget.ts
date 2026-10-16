import type { AgentLifecycle } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import type { AgentMiddleware } from "@anvia/core/tool";
import type { AcpTurnBudget } from "./types.js";

export class TurnBudgetExceeded extends Error {}

export function validateTurnBudget(budget: AcpTurnBudget = {}): void {
  for (const value of [budget.maxModelCalls, budget.maxDurationMs]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new TypeError("Turn limits must be positive safe integers.");
    }
  }
  if (budget.maxDurationMs !== undefined && budget.maxDurationMs > 2 ** 31 - 1) {
    throw new TypeError("Turn deadline exceeds the timer range.");
  }
  if (
    (budget.estimateCost !== undefined && typeof budget.estimateCost !== "function") ||
    (budget.maxCost !== undefined &&
      (!Number.isFinite(budget.maxCost) || budget.maxCost <= 0 || !budget.estimateCost))
  ) {
    throw new TypeError("A cost ceiling requires a finite positive limit and estimator.");
  }
}

export class TurnBudget {
  private calls = 0;
  private usage = Usage.empty();
  private cost = 0;
  private readonly deadline: number;
  private readonly maximum: number;

  constructor(
    private readonly options: AcpTurnBudget = {},
    defaultMaxTurns = 20,
  ) {
    this.maximum = Math.min(options.maxModelCalls ?? Infinity, defaultMaxTurns + 1);
    this.deadline = performance.now() + (options.maxDurationMs ?? Infinity);
  }

  check(): void {
    if (performance.now() >= this.deadline || this.cost >= (this.options.maxCost ?? Infinity)) {
      throw new TurnBudgetExceeded();
    }
  }

  readonly middleware: AgentMiddleware = {
    onCompletionRequest: () => {
      this.check();
      if (this.calls >= this.maximum) throw new TurnBudgetExceeded();
      this.calls++;
      return undefined;
    },
  };

  /** Core usage is cumulative within a segment, but resets at resumption. */
  segment(): AgentLifecycle {
    const previous = this.usage;
    return {
      onStepFinish: ({ usage }) => {
        this.usage = Usage.add(previous, usage);
        if (this.options.maxCost !== undefined) {
          const cost = this.options.estimateCost!({ ...this.usage });
          if (!Number.isFinite(cost) || cost < 0) throw new TypeError("Invalid cost estimate.");
          this.cost = Math.max(this.cost, cost);
        }
        this.check();
      },
    };
  }
}
