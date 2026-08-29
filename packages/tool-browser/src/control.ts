import { randomUUID } from "node:crypto";
import { BrowserError, cancellationError } from "./errors";
import type {
  AcquireBrowserHumanControlOptions,
  BrowserControl,
  BrowserControlAvailability,
  BrowserControlSnapshot,
  BrowserHumanControlLease,
  RenewBrowserHumanControlOptions,
} from "./types";

type PendingAcquire = {
  resolve: () => void;
  reject: (error: unknown) => void;
  abortSignal?: AbortSignal;
  abort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

const defaultAcquireTimeoutMs = 30_000;
const maxTimerMs = 2_147_483_647;

export class BrowserControlState implements BrowserControl {
  private activeAgentActions = 0;
  private pendingAcquire: PendingAcquire | undefined;
  private activeLease: BrowserHumanControlLeaseImpl | undefined;
  private humanPending = false;
  private destroyed = false;
  private availability: BrowserControlAvailability = "available";

  snapshot(): BrowserControlSnapshot {
    const lease = this.activeLease;
    const state =
      lease !== undefined
        ? "human"
        : this.humanPending
          ? "human-pending"
          : this.activeAgentActions > 0
            ? "agent-active"
            : "agent";
    return Object.freeze({
      mode: lease === undefined ? "agent" : "human",
      state,
      availability: this.availability,
      activeAgentActions: this.activeAgentActions,
      humanPending: this.humanPending,
      ...(lease === undefined
        ? {}
        : {
            ownerId: lease.ownerId,
            expiresAt: lease.expiresAt,
          }),
    });
  }

  async acquireHumanControl(
    options: AcquireBrowserHumanControlOptions,
  ): Promise<BrowserHumanControlLease> {
    validateAcquireOptions(options);
    this.assertActive();
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "human-control-acquire");
    }
    if (this.activeLease !== undefined) {
      throw new BrowserError("Browser human control is already acquired.", "human_controlled", {
        phase: "human-control-acquire",
      });
    }
    if (this.humanPending) {
      throw new BrowserError(
        "Browser human control acquisition is already pending.",
        "human_control_conflict",
        { phase: "human-control-acquire" },
      );
    }
    this.humanPending = true;
    try {
      if (this.activeAgentActions > 0) {
        await new Promise<void>((resolve, reject) => {
          const pending: PendingAcquire = { resolve, reject };
          if (options.abortSignal !== undefined) {
            pending.abortSignal = options.abortSignal;
            pending.abort = () => {
              if (this.pendingAcquire !== pending) return;
              this.clearPendingAcquire(pending);
              reject(cancellationError(options.abortSignal?.reason, "human-control-acquire"));
            };
            options.abortSignal.addEventListener("abort", pending.abort, { once: true });
          }
          pending.timer = setTimeout(() => {
            if (this.pendingAcquire !== pending) return;
            this.clearPendingAcquire(pending);
            reject(
              new BrowserError(
                "Timed out waiting to acquire browser human control.",
                "human_control_conflict",
                { phase: "human-control-acquire" },
              ),
            );
          }, options.timeoutMs ?? defaultAcquireTimeoutMs);
          pending.timer.unref?.();
          this.pendingAcquire = pending;
        });
      }

      this.assertActive();
      if (options.abortSignal?.aborted) {
        throw cancellationError(options.abortSignal.reason, "human-control-acquire");
      }
      const lease = new BrowserHumanControlLeaseImpl({
        owner: this,
        ownerId: options.ownerId,
        leaseTimeoutMs: options.leaseTimeoutMs,
      });
      this.activeLease = lease;
      return lease;
    } finally {
      this.humanPending = false;
    }
  }

  async runAgentAction<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    if (this.activeLease !== undefined) {
      throw new BrowserError("Browser is controlled by a human viewer.", "human_controlled", {
        phase: "agent-action",
      });
    }
    if (this.humanPending) {
      throw new BrowserError(
        "Browser human control acquisition is pending.",
        "human_control_conflict",
        { phase: "agent-action" },
      );
    }
    this.activeAgentActions += 1;
    try {
      return await operation();
    } finally {
      this.activeAgentActions -= 1;
      if (this.activeAgentActions === 0) this.resolvePendingAcquire();
    }
  }

  renewLease(
    lease: BrowserHumanControlLeaseImpl,
    options: RenewBrowserHumanControlOptions,
  ): BrowserControlSnapshot {
    if (this.activeLease !== lease) {
      throw new BrowserError("Browser human control lease is no longer active.", "invalid_state");
    }
    assertPositiveSafeInteger(options.leaseTimeoutMs, "leaseTimeoutMs");
    lease.resetExpiration(options.leaseTimeoutMs);
    return this.snapshot();
  }

  releaseLease(lease: BrowserHumanControlLeaseImpl): void {
    if (this.activeLease !== lease) return;
    this.activeLease = undefined;
    lease.markReleased();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.activeLease?.release();
    if (this.pendingAcquire !== undefined) {
      const pending = this.pendingAcquire;
      this.pendingAcquire = undefined;
      this.clearPendingAcquire(pending);
      pending.reject(new BrowserError("Browser was destroyed.", "runtime_destroyed"));
    }
    this.humanPending = false;
    this.availability = "destroyed";
  }

  setAvailability(availability: BrowserControlAvailability): void {
    if (this.destroyed) return;
    if (availability === "destroyed") {
      this.destroy();
      return;
    }
    this.availability = availability;
    if (availability !== "disconnected") return;
    this.activeLease?.release();
    if (this.pendingAcquire !== undefined) {
      const pending = this.pendingAcquire;
      this.clearPendingAcquire(pending);
      pending.reject(
        new BrowserError("Browser runtime is disconnected.", "connection_closed", {
          phase: "human-control-acquire",
        }),
      );
    }
    this.humanPending = false;
  }

  private assertActive(): void {
    if (this.destroyed) throw new BrowserError("Browser was destroyed.", "runtime_destroyed");
    if (this.availability === "disconnected") {
      throw new BrowserError("Browser runtime is disconnected.", "connection_closed");
    }
  }

  private resolvePendingAcquire(): void {
    const pending: PendingAcquire | undefined = this.pendingAcquire;
    if (pending === undefined) return;
    this.clearPendingAcquire(pending);
    pending.resolve();
  }

  private clearPendingAcquire(pending: PendingAcquire): void {
    if (this.pendingAcquire === pending) this.pendingAcquire = undefined;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    if (pending.abort !== undefined) {
      pending.abortSignal?.removeEventListener("abort", pending.abort);
    }
  }
}

class BrowserHumanControlLeaseImpl implements BrowserHumanControlLease {
  readonly id = randomUUID();
  readonly ownerId: string;
  private readonly owner: BrowserControlState;
  private expiration = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private released = false;

  constructor(options: { owner: BrowserControlState; ownerId: string; leaseTimeoutMs: number }) {
    this.owner = options.owner;
    this.ownerId = options.ownerId;
    this.resetExpiration(options.leaseTimeoutMs);
  }

  get expiresAt(): string {
    return new Date(this.expiration).toISOString();
  }

  renew(options: RenewBrowserHumanControlOptions): BrowserControlSnapshot {
    if (this.released) {
      throw new BrowserError("Browser human control lease is no longer active.", "invalid_state");
    }
    return this.owner.renewLease(this, options);
  }

  release(): void {
    this.owner.releaseLease(this);
  }

  markReleased(): void {
    if (this.released) return;
    this.released = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  resetExpiration(leaseTimeoutMs: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.expiration = Date.now() + leaseTimeoutMs;
    this.timer = setTimeout(() => this.release(), leaseTimeoutMs);
    this.timer.unref?.();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.release();
  }
}

function validateAcquireOptions(options: AcquireBrowserHumanControlOptions): void {
  if (!isRecord(options)) throw new TypeError("options must be an object.");
  if (typeof options.ownerId !== "string" || options.ownerId.length === 0) {
    throw new TypeError("ownerId must be a non-empty string.");
  }
  assertPositiveSafeInteger(options.leaseTimeoutMs, "leaseTimeoutMs");
  if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maxTimerMs) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maxTimerMs}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
