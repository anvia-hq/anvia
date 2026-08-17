import { randomUUID } from "node:crypto";
import { BrowserError } from "./errors";
import type {
  AcquireBrowserHumanControlOptions,
  BrowserControl,
  BrowserControlSnapshot,
  BrowserHumanControlLease,
  RenewBrowserHumanControlOptions,
} from "./types";

type PendingAcquire = {
  resolve: () => void;
  reject: (error: unknown) => void;
  abortSignal?: AbortSignal;
  abort?: () => void;
};

export class BrowserControlState implements BrowserControl {
  private activeAgentActions = 0;
  private pendingAcquire: PendingAcquire | undefined;
  private activeLease: BrowserHumanControlLeaseImpl | undefined;
  private humanPending = false;
  private destroyed = false;

  snapshot(): BrowserControlSnapshot {
    const lease = this.activeLease;
    return lease === undefined
      ? Object.freeze({ mode: "agent" })
      : Object.freeze({
          mode: "human",
          ownerId: lease.ownerId,
          expiresAt: lease.expiresAt,
        });
  }

  async acquireHumanControl(
    options: AcquireBrowserHumanControlOptions,
  ): Promise<BrowserHumanControlLease> {
    validateAcquireOptions(options);
    this.assertActive();
    options.abortSignal?.throwIfAborted();
    if (this.activeLease !== undefined || this.humanPending) {
      throw new BrowserError("Browser human control is already acquired.", "human_controlled");
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
              this.pendingAcquire = undefined;
              reject(options.abortSignal?.reason);
            };
            options.abortSignal.addEventListener("abort", pending.abort, { once: true });
          }
          this.pendingAcquire = pending;
        });
      }

      this.assertActive();
      options.abortSignal?.throwIfAborted();
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
    if (this.activeLease !== undefined || this.humanPending) {
      throw new BrowserError("Browser is controlled by a human viewer.", "human_controlled");
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
      if (pending.abort !== undefined) {
        pending.abortSignal?.removeEventListener("abort", pending.abort);
      }
      pending.reject(new BrowserError("Browser was destroyed.", "invalid_state"));
    }
  }

  private assertActive(): void {
    if (this.destroyed) throw new BrowserError("Browser was destroyed.", "invalid_state");
  }

  private resolvePendingAcquire(): void {
    const pending: PendingAcquire | undefined = this.pendingAcquire;
    if (pending === undefined) return;
    this.pendingAcquire = undefined;
    if (pending.abort !== undefined) {
      pending.abortSignal?.removeEventListener("abort", pending.abort);
    }
    pending.resolve();
  }
}

class BrowserHumanControlLeaseImpl implements BrowserHumanControlLease {
  readonly id = randomUUID();
  readonly ownerId: string;
  private readonly owner: BrowserControlState;
  private expiration = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private released = false;

  constructor(options: {
    owner: BrowserControlState;
    ownerId: string;
    leaseTimeoutMs: number;
  }) {
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
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
