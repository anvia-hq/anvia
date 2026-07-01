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
  const completedRunMetrics = props.logs
    .filter((log) => log.category === "run" && log.event === "run.completed")
    .sort((left, right) => left.sequence - right.sequence)
    .map(metricsFromCompletedRunLog);

  let completedRunIndex = 0;
  for (const entry of props.entries) {
    if (!isCompletedAssistantMessage(entry)) {
      continue;
    }

    const fallbackMetrics = completedRunMetrics[completedRunIndex];
    completedRunIndex += 1;
    const metrics =
      entry.traceId === undefined
        ? fallbackMetrics
        : (traceMetrics.get(entry.traceId) ?? fallbackMetrics);
    if (metrics !== undefined) {
      byEntryId.set(entry.entryId, metrics);
    }
  }

  return byEntryId;
}

function isCompletedAssistantMessage(
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: "message"; role: "assistant" }> {
  return (
    entry.kind === "message" &&
    entry.role === "assistant" &&
    entry.text.trim().length > 0 &&
    (!("tone" in entry) || entry.tone !== "pending")
  );
}

function metricsFromTrace(trace: StudioTraceSummary): AssistantResponseMetrics | undefined {
  const durationMs = numericValue(trace.durationMs);
  const usage = usageMetrics(trace.usage);
  return definedMetrics({
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(usage === undefined ? {} : { usage }),
  });
}

function metricsFromCompletedRunLog(
  log: StudioSessionLogEntry,
): AssistantResponseMetrics | undefined {
  const metadata = log.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const durationMs = numericValue(metadata.durationMs);
  const usage = usageMetrics(metadata.usage);
  return definedMetrics({
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(usage === undefined ? {} : { usage }),
  });
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
  const usage: ResponseUsageMetrics = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...definedNumberField("cachedInputTokens", value.cachedInputTokens),
    ...definedNumberField("cacheCreationInputTokens", value.cacheCreationInputTokens),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function definedNumberField<Key extends keyof ResponseUsageMetrics>(
  key: Key,
  value: unknown,
): Pick<ResponseUsageMetrics, Key> | Record<string, never> {
  const numberValue = numericValue(value);
  return numberValue === undefined
    ? {}
    : ({ [key]: numberValue } as Pick<ResponseUsageMetrics, Key>);
}

function definedMetrics(metrics: AssistantResponseMetrics): AssistantResponseMetrics | undefined {
  return metrics.durationMs === undefined && metrics.usage === undefined ? undefined : metrics;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
