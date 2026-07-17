import type { StudioSessionLogEntry, StudioTraceSummary } from "../../../../types";
import { isRecord } from "../shared/object";
import type { TranscriptEntry } from "../shared/types";

export type ResponseUsageMetrics = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type AssistantResponseMetrics = {
  durationMs?: number;
  usage?: ResponseUsageMetrics;
};

export function assistantResponseMetricsByEntryId(props: {
  entries: TranscriptEntry[];
  traceSummaries: StudioTraceSummary[];
  logs: StudioSessionLogEntry[];
}): Map<number, AssistantResponseMetrics> {
  const byEntryId = new Map<number, AssistantResponseMetrics>();
  const traceMetrics = new Map(
    props.traceSummaries
      .map((trace): [string, AssistantResponseMetrics] | undefined => {
        const metrics = metricsFromTrace(trace);
        return metrics === undefined ? undefined : [trace.id, metrics];
      })
      .filter((item): item is [string, AssistantResponseMetrics] => item !== undefined),
  );
  const terminalRunMetrics = props.logs
    .filter(
      (log) =>
        log.category === "run" &&
        (log.event === "run.completed" ||
          log.event === "run.cancelled" ||
          log.event === "run.failed"),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map(metricsFromTerminalRunLog);

  let terminalRunIndex = 0;
  for (const entry of props.entries) {
    if (!isTerminalAssistantMessage(entry)) {
      continue;
    }

    const fallbackMetrics = terminalRunMetrics[terminalRunIndex];
    terminalRunIndex += 1;
    const observedMetrics =
      entry.traceId === undefined
        ? fallbackMetrics
        : (traceMetrics.get(entry.traceId) ?? fallbackMetrics);
    const metrics = mergeEntryDuration(entry.durationMs, observedMetrics);
    if (metrics !== undefined) {
      byEntryId.set(entry.entryId, metrics);
    }
  }

  return byEntryId;
}

function isTerminalAssistantMessage(
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: "message"; role: "assistant" }> {
  return (
    entry.kind === "message" &&
    entry.role === "assistant" &&
    (entry.text.trim().length > 0 || nonnegativeNumericValue(entry.durationMs) !== undefined) &&
    (!("tone" in entry) || entry.tone !== "pending")
  );
}

function metricsFromTrace(trace: StudioTraceSummary): AssistantResponseMetrics | undefined {
  const durationMs = nonnegativeNumericValue(trace.durationMs);
  const usage = usageMetrics(trace.usage);
  const metrics: AssistantResponseMetrics = {};
  if (durationMs !== undefined) metrics.durationMs = durationMs;
  if (usage !== undefined) metrics.usage = usage;
  return definedMetrics(metrics);
}

function metricsFromTerminalRunLog(
  log: StudioSessionLogEntry,
): AssistantResponseMetrics | undefined {
  const metadata = log.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const durationMs = nonnegativeNumericValue(metadata.durationMs);
  const usage = usageMetrics(metadata.usage);
  const metrics: AssistantResponseMetrics = {};
  if (durationMs !== undefined) metrics.durationMs = durationMs;
  if (usage !== undefined) metrics.usage = usage;
  return definedMetrics(metrics);
}

function usageMetrics(value: unknown): ResponseUsageMetrics | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = numericValue(value.inputTokens);
  const outputTokens = numericValue(value.outputTokens);
  const totalTokens =
    numericValue(value.totalTokens) ??
    (inputTokens === undefined || outputTokens === undefined
      ? undefined
      : inputTokens + outputTokens);
  const usage: ResponseUsageMetrics = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  const cachedInputTokens = numericValue(value.cachedInputTokens);
  const cacheCreationInputTokens = numericValue(value.cacheCreationInputTokens);
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (cacheCreationInputTokens !== undefined) {
    usage.cacheCreationInputTokens = cacheCreationInputTokens;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function definedMetrics(metrics: AssistantResponseMetrics): AssistantResponseMetrics | undefined {
  return metrics.durationMs === undefined && metrics.usage === undefined ? undefined : metrics;
}

function mergeEntryDuration(
  durationMs: number | undefined,
  metrics: AssistantResponseMetrics | undefined,
): AssistantResponseMetrics | undefined {
  const persistedDurationMs = nonnegativeNumericValue(durationMs);
  if (persistedDurationMs === undefined) {
    return metrics;
  }
  return {
    ...metrics,
    durationMs: persistedDurationMs,
  };
}

function nonnegativeNumericValue(value: unknown): number | undefined {
  const number = numericValue(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
