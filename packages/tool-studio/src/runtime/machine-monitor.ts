import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os";
import type {
  StudioMachineMonitorHistory,
  StudioMachineMonitorOptions,
  StudioMachineMonitorRange,
  StudioMachineMonitorSample,
  StudioMachineMonitorStore,
  StudioMachineMonitorSummary,
} from "../types";

const dayMs = 24 * 60 * 60 * 1000;
const defaultSampleIntervalMs = 60_000;
const defaultMaxHistoryPoints = 720;
const historyBucketQuantumMs = 5 * 60_000;

type CpuSnapshot = { idle: number; total: number };

export type MachineMonitorRuntimeOptions = {
  runnerId: string;
  store: StudioMachineMonitorStore;
  config?: StudioMachineMonitorOptions;
  now?: () => Date;
  collect?: (sourceId: string, timestamp: Date) => StudioMachineMonitorSample;
};

export class MachineMonitor {
  readonly sourceId: string;
  readonly retentionDays: 7 | 30;
  readonly sampleIntervalMs: number;
  readonly maxHistoryPoints: number;
  private readonly store: StudioMachineMonitorStore;
  private readonly now: () => Date;
  private readonly collect: (sourceId: string, timestamp: Date) => StudioMachineMonitorSample;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> = Promise.resolve();
  private currentSample: StudioMachineMonitorSample | undefined;

  constructor(options: MachineMonitorRuntimeOptions) {
    const config = options.config ?? {};
    this.sourceId = normalizeSourceId(config.sourceId ?? `${hostname()}:${options.runnerId}`);
    this.retentionDays = config.retentionDays ?? 30;
    this.sampleIntervalMs = config.sampleIntervalMs ?? defaultSampleIntervalMs;
    this.maxHistoryPoints = config.maxHistoryPoints ?? defaultMaxHistoryPoints;
    assertMachineMonitorOptions(this.retentionDays, this.sampleIntervalMs, this.maxHistoryPoints);
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    const sampler = new SystemMachineSampler();
    this.collect =
      options.collect ?? ((sourceId, timestamp) => sampler.collect(sourceId, timestamp));
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.queueSample();
    this.timer = setInterval(() => this.queueSample(), this.sampleIntervalMs);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  async summary(): Promise<StudioMachineMonitorSummary> {
    await this.pending;
    if (this.currentSample === undefined) {
      this.currentSample = this.collect(this.sourceId, this.now());
    }
    return {
      sourceId: this.sourceId,
      retentionDays: this.retentionDays,
      sampleIntervalSeconds: this.sampleIntervalMs / 1000,
      availableRanges: this.availableRanges(),
      current: structuredClone(this.currentSample),
    };
  }

  async history(range: StudioMachineMonitorRange): Promise<StudioMachineMonitorHistory> {
    if (!this.availableRanges().includes(range)) {
      throw new RangeError(
        `${range} history is unavailable with ${this.retentionDays}-day retention.`,
      );
    }
    await this.pending;
    const to = this.now();
    const rangeMs = range === "7d" ? 7 * dayMs : 30 * dayMs;
    const from = new Date(to.getTime() - rangeMs);
    const bucketMs = Math.max(
      this.sampleIntervalMs,
      Math.ceil(rangeMs / this.maxHistoryPoints / historyBucketQuantumMs) * historyBucketQuantumMs,
    );
    const samples = await this.store.listMachineMonitorSamples({
      sourceId: this.sourceId,
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs,
      limit: this.maxHistoryPoints + 1,
    });
    return {
      sourceId: this.sourceId,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      bucketSeconds: bucketMs / 1000,
      retentionDays: this.retentionDays,
      samples: samples.slice(-this.maxHistoryPoints),
    };
  }

  private availableRanges(): StudioMachineMonitorRange[] {
    return this.retentionDays === 30 ? ["7d", "30d"] : ["7d"];
  }

  private queueSample(): void {
    this.pending = this.pending
      .then(async () => {
        const timestamp = this.now();
        const sample = this.collect(this.sourceId, timestamp);
        this.currentSample = sample;
        await this.store.appendMachineMonitorSample(sample);
        await this.store.deleteMachineMonitorSamples({
          sourceId: this.sourceId,
          before: new Date(timestamp.getTime() - this.retentionDays * dayMs).toISOString(),
        });
      })
      .catch((error: unknown) => {
        // The current reading remains useful even if a caller-provided persistence adapter fails.
        console.error("Failed to persist Studio machine monitor sample", error);
      });
  }
}

class SystemMachineSampler {
  private previousCpu: CpuSnapshot | undefined;

  collect(sourceId: string, timestamp: Date): StudioMachineMonitorSample {
    const cpu = cpuSnapshot();
    const baseline = this.previousCpu;
    this.previousCpu = cpu;
    const idle = cpu.idle - (baseline?.idle ?? 0);
    const total = cpu.total - (baseline?.total ?? 0);
    const cpuPercent = total <= 0 ? 0 : clamp(((total - idle) / total) * 100, 0, 100);
    const memoryTotalBytes = totalmem();
    const [loadAverage1m, loadAverage5m, loadAverage15m] = loadavg();
    return {
      sourceId,
      timestamp: timestamp.toISOString(),
      cpuPercent,
      memoryUsedBytes: memoryTotalBytes - freemem(),
      memoryTotalBytes,
      processRssBytes: process.memoryUsage().rss,
      loadAverage1m: loadAverage1m ?? 0,
      loadAverage5m: loadAverage5m ?? 0,
      loadAverage15m: loadAverage15m ?? 0,
      uptimeSeconds: uptime(),
    };
  }
}

function cpuSnapshot(): CpuSnapshot {
  return cpus().reduce<CpuSnapshot>(
    (snapshot, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return { idle: snapshot.idle + cpu.times.idle, total: snapshot.total + total };
    },
    { idle: 0, total: 0 },
  );
}

function normalizeSourceId(sourceId: string): string {
  const normalized = sourceId.trim();
  if (normalized.length === 0 || normalized.length > 240) {
    throw new TypeError("machineMonitor.sourceId must contain between 1 and 240 characters.");
  }
  return normalized;
}

function assertMachineMonitorOptions(
  retentionDays: number,
  sampleIntervalMs: number,
  maxHistoryPoints: number,
): void {
  if (retentionDays !== 7 && retentionDays !== 30) {
    throw new RangeError("machineMonitor.retentionDays must be 7 or 30.");
  }
  if (!Number.isSafeInteger(sampleIntervalMs) || sampleIntervalMs < 1000) {
    throw new RangeError("machineMonitor.sampleIntervalMs must be an integer of at least 1000.");
  }
  if (!Number.isSafeInteger(maxHistoryPoints) || maxHistoryPoints < 24 || maxHistoryPoints > 2000) {
    throw new RangeError("machineMonitor.maxHistoryPoints must be an integer from 24 to 2000.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
