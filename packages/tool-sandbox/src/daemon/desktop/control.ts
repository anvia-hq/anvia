import { DockerSandboxError } from "../../errors";
import type { DesktopControl } from "../../remote/protocol";

export interface DesktopControlOptions {
  leaseMs?: number | undefined;
  maxLeaseMs?: number | undefined;
  waitForReleaseMs?: number | undefined;
}

const defaultLeaseMs = 60_000;
const defaultMaxLeaseMs = 60 * 60 * 1_000;

/**
 * Who is driving the desktop. A human takes over, which makes the agent's inputs fail with
 * `desktop_locked` until they release or the lease runs out. Watching is never blocked, and neither
 * are the agent's read-only calls (screenshots, the cursor position).
 *
 * The hold is a lease the holder keeps renewing, so a viewer that vanishes cannot lock the agent
 * out for good. It lives in the daemon, not in a connection, so it survives a hub restart.
 */
export class DesktopControlLock {
  private holder: string | undefined;
  private expiresAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiters: Array<() => void> = [];
  private readonly leaseMs: number;
  private readonly maxLeaseMs: number;
  private readonly waitForReleaseMs: number;

  constructor(options: DesktopControlOptions = {}) {
    this.leaseMs = options.leaseMs ?? defaultLeaseMs;
    this.maxLeaseMs = options.maxLeaseMs ?? defaultMaxLeaseMs;
    this.waitForReleaseMs = options.waitForReleaseMs ?? 0;
  }

  snapshot(): DesktopControl {
    if (this.holder === undefined) return { held: false };
    return { held: true, holder: this.holder, expiresAt: new Date(this.expiresAt).toISOString() };
  }

  /** Take control, or renew it if `holder` already has it. Another holder's hold is not overridden. */
  takeover(holder: string, leaseMs?: number): DesktopControl {
    if (this.holder !== undefined && this.holder !== holder) {
      throw new DockerSandboxError(
        `The desktop is controlled by ${this.holder}.`,
        "desktop_locked",
      );
    }
    const lease = Math.min(leaseMs ?? this.leaseMs, this.maxLeaseMs);
    this.holder = holder;
    this.expiresAt = Date.now() + lease;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), lease);
    this.timer.unref?.();
    return this.snapshot();
  }

  /** Give control back. A named holder can only release its own; `force` releases anyone's. */
  release(holder?: string, force = false): DesktopControl {
    if (this.holder !== undefined && !force && holder !== undefined && holder !== this.holder) {
      throw new DockerSandboxError(
        `The desktop is controlled by ${this.holder}.`,
        "desktop_locked",
      );
    }
    this.clear();
    return this.snapshot();
  }

  /** Called before an agent input. Fails, or waits for a release if configured to. */
  async assertAgentInput(signal?: AbortSignal): Promise<void> {
    if (this.holder === undefined) return;
    if (this.waitForReleaseMs > 0) await this.waitForRelease(signal);
    if (this.holder !== undefined) {
      throw new DockerSandboxError(
        `The desktop is controlled by ${this.holder}; agent input is paused until they release it.`,
        "desktop_locked",
        { holder: this.holder },
      );
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.wake();
  }

  private waitForRelease(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timeout);
        this.waiters = this.waiters.filter((waiter) => waiter !== done);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timeout = setTimeout(done, this.waitForReleaseMs);
      this.waiters.push(done);
      if (signal?.aborted === true) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private expire(): void {
    this.clear();
  }

  private clear(): void {
    this.holder = undefined;
    this.expiresAt = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }
}
