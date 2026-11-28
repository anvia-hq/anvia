import type { AgentLifecycle } from "@anvia/core/agent";
import type { Usage } from "@anvia/core/completion";

export type UsageReportStatus = "completed" | "blocked" | "suspended" | "error";

export type UsageReport = {
  runId: string;
  status: UsageReportStatus;
  steps: number;
  toolCalls: number;
  toolFailures: number;
  durationMs: number;
  usage: Usage;
};

export type UsageHookOptions = {
  onReport(report: UsageReport): void | Promise<void>;
  /** Custom clock for deterministic testing. Default `Date.now`. */
  now?: (() => number) | undefined;
};

type RunCounters = {
  startedAt: number;
  steps: number;
  toolCalls: number;
  toolFailures: number;
};

const MAX_REPORTED_RUN_HISTORY = 256;

export function usageHook<Output = unknown, RawResponse = unknown>(
  options: UsageHookOptions,
): AgentLifecycle<Output, RawResponse> {
  const now = options.now ?? Date.now;
  const activeRuns = new Map<string, RunCounters>();
  const reportedRuns = new Set<string>();

  const rememberReported = (runId: string): void => {
    reportedRuns.add(runId);

    if (reportedRuns.size > MAX_REPORTED_RUN_HISTORY) {
      const oldest = reportedRuns.values().next().value;

      if (oldest !== undefined) reportedRuns.delete(oldest);
    }
  };

  const getOrCreate = (runId: string): RunCounters => {
    let entry = activeRuns.get(runId);

    if (entry === undefined) {
      entry = { startedAt: now(), steps: 0, toolCalls: 0, toolFailures: 0 };
      activeRuns.set(runId, entry);
    }

    return entry;
  };

  return {
    onStart(event) {
      reportedRuns.delete(event.runId);
      activeRuns.set(event.runId, {
        startedAt: now(),
        steps: 0,
        toolCalls: 0,
        toolFailures: 0,
      });
    },
    onStepFinish(event) {
      getOrCreate(event.runId).steps += 1;
    },
    onToolFinish(event) {
      const counters = getOrCreate(event.runId);
      counters.toolCalls += 1;

      if (!event.success) counters.toolFailures += 1;
    },
    async onFinish(event) {
      const counters = activeRuns.get(event.runId) ?? {
        startedAt: now(),
        steps: 0,
        toolCalls: 0,
        toolFailures: 0,
      };
      activeRuns.delete(event.runId);
      rememberReported(event.runId);

      await options.onReport({
        runId: event.runId,
        status: event.status,
        steps: counters.steps,
        toolCalls: counters.toolCalls,
        toolFailures: counters.toolFailures,
        durationMs: Math.max(0, now() - counters.startedAt),
        usage: { ...event.usage },
      });
    },
    async onError(event) {
      if (reportedRuns.has(event.runId)) {
        return;
      }

      const counters = activeRuns.get(event.runId) ?? {
        startedAt: now(),
        steps: 0,
        toolCalls: 0,
        toolFailures: 0,
      };
      activeRuns.delete(event.runId);
      rememberReported(event.runId);

      await options.onReport({
        runId: event.runId,
        status: "error",
        steps: counters.steps,
        toolCalls: counters.toolCalls,
        toolFailures: counters.toolFailures,
        durationMs: Math.max(0, now() - counters.startedAt),
        usage: { ...event.usage },
      });
    },
  };
}
