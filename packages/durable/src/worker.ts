import { DurableRuntime } from "./runtime.js";
import type {
  DurableAgentCompatibility,
  DurableAgentRegistration,
  DurableRuntimeOptions,
  DurableWorkerOptions,
} from "./types.js";
import type { DurableLimits } from "./limits.js";

export type DurableWorkerStartOptions = Pick<
  DurableRuntimeOptions,
  | "store"
  | "agents"
  | "tasks"
  | "maxConcurrentTasks"
  | "limits"
  | "maxConcurrentRuns"
  | "pollIntervalMs"
  | "onFatalError"
  | "onCompatibility"
> &
  DurableWorkerOptions;

/**
 * Executes durable runs that clients submit. It registers agents, claims runs from the shared
 * store, renews its claims and stops a run whose claim it loses; it has no submit or control
 * methods, which belong to `DurableClient`. Start several workers on one Postgres, Drizzle, or
 * Prisma database to divide the work, and add or remove them without coordination: a worker that
 * stops lets its runs be taken over after `leaseMs`.
 *
 * It is a role over `DurableRuntime` in worker mode, so agent registration, limits and
 * compatibility behave as documented there. A worker cannot share a database with an owning
 * runtime, and it executes agent runs, graphs, custom tasks and goals (ADR 0001).
 */
export class DurableWorker {
  private constructor(
    private readonly runtime: DurableRuntime,
    /** The id this worker's claims carry. */
    readonly workerId: string,
  ) {}

  static async start(options: DurableWorkerStartOptions): Promise<DurableWorker> {
    const { workerId, leaseMs, heartbeatMs, ...rest } = options;
    const id = workerId ?? `worker-${globalThis.crypto.randomUUID()}`;
    const worker: DurableWorkerOptions = { workerId: id };
    if (leaseMs !== undefined) worker.leaseMs = leaseMs;
    if (heartbeatMs !== undefined) worker.heartbeatMs = heartbeatMs;
    const runtime = await DurableRuntime.open({ ...rest, worker });
    return new DurableWorker(runtime, id);
  }

  /** Adds agents this worker may execute. See `DurableRuntime.registerAgents()`. */
  registerAgents(values: readonly DurableAgentRegistration[]): void {
    this.runtime.registerAgents(values);
  }

  /**
   * Stops claiming an agent's runs. It fails while an attempt of that agent is active here; runs
   * still queued in the store wait for a worker that registers the agent.
   */
  unregisterAgent(id: string): Promise<boolean> {
    return this.runtime.unregisterAgent(id);
  }

  compatibility(): readonly DurableAgentCompatibility[] {
    return this.runtime.compatibility();
  }

  limits(): DurableLimits {
    return this.runtime.limits();
  }

  metrics() {
    return this.runtime.metrics();
  }

  /** Does not touch storage, so a supervisor can inspect a failed worker. */
  health() {
    return this.runtime.health();
  }

  /** Stops claiming, aborts active attempts and releases their claims so others take over at once. */
  close(): Promise<void> {
    return this.runtime.close();
  }
}
