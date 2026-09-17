// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MachineMonitorPanel } from "../src/ui/app/modules/status/machine-monitor-panel";
import type { StudioMachineMonitorHistory, StudioMachineMonitorSummary } from "../src/types";

const current = {
  sourceId: "workstation:studio",
  timestamp: "2026-09-17T12:00:00.000Z",
  cpuPercent: 38.4,
  memoryUsedBytes: 8 * 1024 ** 3,
  memoryTotalBytes: 16 * 1024 ** 3,
  processRssBytes: 256 * 1024 ** 2,
  loadAverage1m: 1.2,
  loadAverage5m: 1,
  loadAverage15m: 0.8,
  uptimeSeconds: 3600,
};

const summary: StudioMachineMonitorSummary = {
  sourceId: current.sourceId,
  retentionDays: 30,
  sampleIntervalSeconds: 60,
  availableRanges: ["7d", "30d"],
  current,
};

describe("machine monitor UI", () => {
  it("keeps current readings visible while history is empty", () => {
    const html = renderToStaticMarkup(
      <MachineMonitorPanel
        summary={summary}
        history={{ ...history(), samples: [current] }}
        range="7d"
        loading={false}
        error=""
        onRangeChange={vi.fn()}
      />,
    );

    expect(html).toContain("38.4%");
    expect(html).toContain("8 GB / 16 GB");
    expect(html).toContain("History is building");
    expect(html).toContain("7 days");
    expect(html).toContain("30 days");
  });

  it("renders units, local-time guidance, and both utilization series", () => {
    const second = { ...current, timestamp: "2026-09-17T12:15:00.000Z", cpuPercent: 48 };
    const html = renderToStaticMarkup(
      <MachineMonitorPanel
        summary={summary}
        history={{ ...history(), samples: [current, second] }}
        range="7d"
        loading={false}
        error=""
        onRangeChange={vi.fn()}
      />,
    );

    expect(html).toContain("CPU (%)");
    expect(html).toContain("Memory (%)");
    expect(html).toContain("browser&#x27;s local time");
    expect(html).toContain("stored in UTC");
    expect(html).toContain("CPU and memory utilization history");
    expect((html.match(/<polyline/g) ?? []).length).toBe(2);
  });

  it("shows a history error without hiding current values", () => {
    const html = renderToStaticMarkup(
      <MachineMonitorPanel
        summary={summary}
        history={undefined}
        range="30d"
        loading={false}
        error="History failed with HTTP 500"
        onRangeChange={vi.fn()}
      />,
    );

    expect(html).toContain("38.4%");
    expect(html).toContain("History unavailable");
    expect(html).toContain("History failed with HTTP 500");
  });
});

function history(): StudioMachineMonitorHistory {
  return {
    sourceId: current.sourceId,
    range: "7d",
    from: "2026-09-10T12:00:00.000Z",
    to: current.timestamp,
    bucketSeconds: 900,
    retentionDays: 30,
    samples: [],
  };
}
