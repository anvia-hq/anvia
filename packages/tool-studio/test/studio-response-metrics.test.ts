import { describe, expect, it } from "vitest";
import type { StudioSessionLogEntry, StudioTraceSummary } from "../src/types";
import { assistantResponseMetricsByEntryId } from "../src/ui/app/modules/playground/response-metrics";
import type { TranscriptEntry } from "../src/ui/app/modules/shared/types";

describe("assistant response metrics", () => {
  it("prefers trace summary metrics and falls back to completed run logs by response order", () => {
    const metrics = assistantResponseMetricsByEntryId({
      entries: [
        { entryId: 1, kind: "message", role: "user", text: "First" },
        {
          entryId: 2,
          kind: "message",
          role: "assistant",
          text: "First answer",
          traceId: "trace_1",
        },
        { entryId: 3, kind: "message", role: "user", text: "Second" },
        { entryId: 4, kind: "message", role: "assistant", text: "Second answer" },
      ] as TranscriptEntry[],
      traceSummaries: [traceSummary("trace_1", 30, 1_200)],
      logs: [completedRunLog("run_1", 1, 99, 9_900), completedRunLog("run_2", 2, 8, 500)],
    });

    expect(metrics.get(2)).toEqual({
      durationMs: 1_200,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
    expect(metrics.get(4)).toEqual({
      durationMs: 500,
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    });
  });

  it("does not create metrics for pending or empty assistant messages", () => {
    const metrics = assistantResponseMetricsByEntryId({
      entries: [
        { entryId: 1, kind: "message", role: "assistant", text: "", tone: "pending" },
        { entryId: 2, kind: "message", role: "assistant", text: "  " },
      ] as TranscriptEntry[],
      traceSummaries: [traceSummary("trace_1", 30, 1_200)],
      logs: [completedRunLog("run_1", 1, 99, 9_900)],
    });

    expect(metrics.size).toBe(0);
  });

  it("uses persisted durations for empty responses and terminal logs for legacy responses", () => {
    const metrics = assistantResponseMetricsByEntryId({
      entries: [
        { entryId: 1, kind: "message", role: "user", text: "First" },
        {
          entryId: 2,
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: 2_500,
        },
        { entryId: 3, kind: "message", role: "user", text: "Second" },
        { entryId: 4, kind: "message", role: "assistant", text: "Failed" },
      ] as TranscriptEntry[],
      traceSummaries: [],
      logs: [
        terminalRunLog("run_1", 1, "run.cancelled", 9_900),
        terminalRunLog("run_2", 2, "run.failed", 500),
      ],
    });

    expect(metrics.get(2)).toEqual({ durationMs: 2_500 });
    expect(metrics.get(4)).toEqual({ durationMs: 500 });
  });
});

function traceSummary(id: string, totalTokens: number, durationMs: number): StudioTraceSummary {
  return {
    id,
    sessionId: "session_1",
    status: "success",
    startedAt: "2026-06-20T12:00:00.000Z",
    durationMs,
    usage: {
      inputTokens: 10,
      outputTokens: totalTokens - 10,
      totalTokens,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    observationCount: 1,
  };
}

function completedRunLog(
  runId: string,
  sequence: number,
  totalTokens: number,
  durationMs: number,
): StudioSessionLogEntry {
  return {
    id: `log_${sequence}`,
    sessionId: "session_1",
    runId,
    sequence,
    timestamp: "2026-06-20T12:00:00.000Z",
    level: "info",
    category: "run",
    event: "run.completed",
    message: "Run completed",
    metadata: {
      durationMs,
      usage: {
        inputTokens: 3,
        outputTokens: totalTokens - 3,
        totalTokens,
      },
    },
  };
}

function terminalRunLog(
  runId: string,
  sequence: number,
  event: "run.cancelled" | "run.failed",
  durationMs: number,
): StudioSessionLogEntry {
  return {
    id: `log_${sequence}`,
    sessionId: "session_1",
    runId,
    sequence,
    timestamp: "2026-06-20T12:00:00.000Z",
    level: event === "run.failed" ? "error" : "info",
    category: "run",
    event,
    message: event === "run.failed" ? "Run failed" : "Run cancelled",
    metadata: { durationMs },
  };
}
