import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Studio } from "../src/runner";
import { createSqliteSessionStore } from "../src/sqlite";
import { createInMemoryStudioStore } from "../src/storage/memory-store";
import { MachineMonitor } from "../src/runtime/machine-monitor";
import type { StudioMachineMonitorSample } from "../src/types";

describe("Studio machine monitor", () => {
  it("keeps history scoped by source and bounds aggregated responses", async () => {
    const store = createInMemoryStudioStore();
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    for (let index = 0; index < 240; index += 1) {
      store.appendMachineMonitorSample(
        sample("runtime-a", new Date(now - index * 60_000).toISOString(), index % 100),
      );
      store.appendMachineMonitorSample(
        sample("runtime-b", new Date(now - index * 60_000).toISOString(), 99),
      );
    }

    const monitor = new MachineMonitor({
      runnerId: "studio",
      store,
      config: {
        sourceId: "runtime-a",
        retentionDays: 30,
        sampleIntervalMs: 60_000,
        maxHistoryPoints: 24,
      },
      now: () => new Date(now),
      collect: (sourceId, timestamp) => sample(sourceId, timestamp.toISOString(), 42),
    });
    monitor.start();
    const history = await monitor.history("7d");
    const monthlyHistory = await monitor.history("30d");
    monitor.close();

    expect(history.samples.length).toBeLessThanOrEqual(24);
    expect(history.samples).not.toHaveLength(0);
    expect(history.samples.every((entry) => entry.sourceId === "runtime-a")).toBe(true);
    expect(history.bucketSeconds).toBeGreaterThanOrEqual(15 * 60);
    expect(monthlyHistory.bucketSeconds).toBeGreaterThanOrEqual(60 * 60);
  });

  it("removes expired samples on startup and does not return them after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-machine-monitor-"));
    const path = join(directory, "studio.sqlite");
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    const firstStore = createSqliteSessionStore({ path });
    firstStore.appendMachineMonitorSample(
      sample("runtime-a", new Date(now - 31 * 86_400_000).toISOString(), 8),
    );
    firstStore.appendMachineMonitorSample(
      sample("runtime-a", new Date(now - 2 * 86_400_000).toISOString(), 22),
    );

    const restartedStore = createSqliteSessionStore({ path });
    const monitor = new MachineMonitor({
      runnerId: "studio",
      store: restartedStore,
      config: { sourceId: "runtime-a", retentionDays: 30 },
      now: () => new Date(now),
      collect: (sourceId, timestamp) => sample(sourceId, timestamp.toISOString(), 44),
    });
    monitor.start();
    await monitor.summary();
    const samples = await restartedStore.listMachineMonitorSamples({
      sourceId: "runtime-a",
      from: new Date(now - 40 * 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
      bucketMs: 60_000,
      limit: 100,
    });
    monitor.close();

    expect(samples.map((entry) => entry.cpuPercent)).toEqual([22, 44]);
  });

  it("exposes current readings, range metadata, and retention validation over HTTP", async () => {
    const studio = new Studio([], {
      machineMonitor: { sourceId: "runtime-http", retentionDays: 7 },
    });

    const status = await studio.fetch(new Request("http://studio.test/status"));
    await expect(status.json()).resolves.toMatchObject({
      machine: {
        sourceId: "runtime-http",
        retentionDays: 7,
        availableRanges: ["7d"],
        current: {
          sourceId: "runtime-http",
          timestamp: expect.stringMatching(/Z$/),
        },
      },
    });

    const history = await studio.fetch(new Request("http://studio.test/status/history?range=7d"));
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      sourceId: "runtime-http",
      range: "7d",
      retentionDays: 7,
      samples: expect.any(Array),
    });

    const unavailable = await studio.fetch(
      new Request("http://studio.test/status/history?range=30d"),
    );
    expect(unavailable.status).toBe(400);
    studio.close();
  });

  it("rejects sampling and retention configurations that cannot satisfy the contract", () => {
    const store = createInMemoryStudioStore();
    expect(
      () =>
        new MachineMonitor({
          runnerId: "studio",
          store,
          config: { retentionDays: 7, sampleIntervalMs: 500 },
        }),
    ).toThrow("sampleIntervalMs");
    expect(
      () =>
        new MachineMonitor({
          runnerId: "studio",
          store,
          config: { retentionDays: 30, maxHistoryPoints: 10 },
        }),
    ).toThrow("maxHistoryPoints");
  });
});

function sample(
  sourceId: string,
  timestamp: string,
  cpuPercent: number,
): StudioMachineMonitorSample {
  return {
    sourceId,
    timestamp,
    cpuPercent,
    memoryUsedBytes: 8 * 1024 ** 3,
    memoryTotalBytes: 16 * 1024 ** 3,
    processRssBytes: 256 * 1024 ** 2,
    loadAverage1m: 1.2,
    loadAverage5m: 1,
    loadAverage15m: 0.8,
    uptimeSeconds: 3600,
  };
}
