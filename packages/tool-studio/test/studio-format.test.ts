import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioConfig, StudioTrace } from "../src/types";
import {
  agentLabel,
  formatDuration,
  formatRelativeTime,
  formatToolValue,
  formatTraceDate,
  formatTraceTime,
  formatUsage,
  parseToolDisplayValue,
  titleFromText,
  toTraceStatusFilter,
  traceAgentId,
  traceAgentLabel,
} from "../src/ui/app/modules/shared/format";

const agents: StudioConfig["agents"] = [
  { id: "support", name: "Support", quickPrompts: [] },
  { id: "ops", quickPrompts: [] },
];

describe("Studio formatting helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats relative times across the display buckets", () => {
    expect(formatRelativeTime("not-a-date")).toBe("");
    expect(formatRelativeTime("2026-06-20T11:59:30.000Z")).toBe("now");
    expect(formatRelativeTime("2026-06-20T11:15:00.000Z")).toBe("45m");
    expect(formatRelativeTime("2026-06-20T03:00:00.000Z")).toBe("9h");
    expect(formatRelativeTime("2026-06-17T12:00:00.000Z")).toBe("3d");
    expect(formatRelativeTime("2026-06-01T12:00:00.000Z")).toBe("2w");
    expect(formatRelativeTime("2026-01-20T12:00:00.000Z")).toBe("5mo");
    expect(formatRelativeTime("2026-06-20T12:01:00.000Z")).toBe("now");
  });

  it("formats trace time, date, duration, and usage", () => {
    expect(formatTraceTime("bad")).toBe("");
    expect(formatTraceTime("2026-06-20T11:05:00.000Z")).toMatch(/\d{1,2}:05/);
    expect(formatTraceDate("bad")).toBe("");
    expect(formatTraceDate("2026-06-20T11:05:00.000Z")).toMatch(/Jun 20/);
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatUsage(undefined)).toBe("-");
    expect(
      formatUsage({
        inputTokens: 3,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 4,
        totalTokens: 7,
      }),
    ).toBe("7 tok");
  });

  it("formats agent and trace agent fallbacks", () => {
    expect(agentLabel(agents, "support")).toBe("Support");
    expect(agentLabel(agents, "missing")).toBe("missing");

    const metadataTrace = trace({ metadata: { agentName: "Metadata Agent", agentId: "support" } });
    expect(traceAgentId(metadataTrace)).toBe("support");
    expect(traceAgentLabel(agents, metadataTrace)).toBe("Metadata Agent");
    expect(traceAgentLabel(agents, trace({ metadata: { metadata: { agentId: "ops" } } }))).toBe(
      "ops",
    );
    expect(traceAgentLabel(agents, trace({ metadata: [] as never }))).toBe("-");
    expect(toTraceStatusFilter("running")).toBe("running");
    expect(toTraceStatusFilter("unknown")).toBe("all");
  });

  it("formats and parses tool display values", () => {
    expect(formatToolValue(undefined)).toBe("");
    expect(formatToolValue({ ok: true })).toBe('{\n  "ok": true\n}');

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(formatToolValue(circular)).toBe("[object Object]");

    expect(parseToolDisplayValue('  {"ok":true} ')).toEqual({
      kind: "json",
      value: { ok: true },
    });
    expect(parseToolDisplayValue("not json")).toEqual({ kind: "text", value: "not json" });
    expect(parseToolDisplayValue("   ")).toEqual({ kind: "text", value: "   " });
  });

  it("normalizes and truncates titles from text", () => {
    expect(titleFromText("  hello\n\nworld\tagain  ")).toBe("hello world again");
    expect(titleFromText("x".repeat(80))).toBe(`${"x".repeat(69)}...`);
  });
});

function trace(overrides: Partial<StudioTrace>): StudioTrace {
  return {
    id: "trace_1",
    sessionId: "session_1",
    status: "success",
    startedAt: "2026-06-20T12:00:00.000Z",
    observationCount: 0,
    observations: [],
    ...overrides,
  };
}
