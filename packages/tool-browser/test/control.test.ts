import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserControlState } from "../src/control";

describe("BrowserControlState", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for an active agent action before granting human control", async () => {
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const acquiring = control.acquireHumanControl({
      ownerId: "studio-viewer",
      leaseTimeoutMs: 30_000,
    });

    await expect(control.runAgentAction(async () => undefined)).rejects.toMatchObject({
      code: "human_control_conflict",
    });
    finishAction?.();
    await action;
    const lease = await acquiring;
    expect(control.snapshot()).toMatchObject({ mode: "human", ownerId: "studio-viewer" });
    await expect(control.runAgentAction(async () => undefined)).rejects.toMatchObject({
      code: "human_controlled",
    });

    lease.release();
    await expect(control.runAgentAction(async () => "agent")).resolves.toBe("agent");
  });

  it("expires and renews human control leases", async () => {
    vi.useFakeTimers();
    const control = new BrowserControlState();
    const lease = await control.acquireHumanControl({ ownerId: "viewer", leaseTimeoutMs: 20 });
    const firstExpiration = lease.expiresAt;
    lease.renew({ leaseTimeoutMs: 100 });
    expect(Date.parse(lease.expiresAt)).toBeGreaterThanOrEqual(Date.parse(firstExpiration));
    await vi.advanceTimersByTimeAsync(120);
    expect(control.snapshot()).toMatchObject({ mode: "agent", state: "agent" });
  });

  it("propagates abort while takeover waits for an action", async () => {
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const controller = new AbortController();
    const acquiring = control.acquireHumanControl({
      ownerId: "viewer",
      leaseTimeoutMs: 30_000,
      abortSignal: controller.signal,
    });
    controller.abort(new Error("cancelled"));
    await expect(acquiring).rejects.toThrow("cancelled");
    finishAction?.();
    await action;
    await expect(control.runAgentAction(async () => "available")).resolves.toBe("available");
  });

  it("times out acquisition and completely clears pending state", async () => {
    vi.useFakeTimers();
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const acquiring = control.acquireHumanControl({
      ownerId: "viewer",
      leaseTimeoutMs: 30_000,
      timeoutMs: 50,
    });
    const rejected = expect(acquiring).rejects.toMatchObject({
      code: "human_control_conflict",
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(control.snapshot()).toMatchObject({ state: "agent-active", humanPending: false });
    finishAction?.();
    await action;
    await expect(control.runAgentAction(async () => "resumed")).resolves.toBe("resumed");
  });

  it("rejects a second human acquisition while the first is pending", async () => {
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const controller = new AbortController();
    const first = control.acquireHumanControl({
      ownerId: "first",
      leaseTimeoutMs: 30_000,
      abortSignal: controller.signal,
    });

    await expect(
      control.acquireHumanControl({ ownerId: "second", leaseTimeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: "human_control_conflict" });
    controller.abort(new Error("cancel first acquisition"));
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    finishAction?.();
    await action;
  });

  it("rejects simultaneous acquisition and tolerates release racing with destroy", async () => {
    const control = new BrowserControlState();
    const lease = await control.acquireHumanControl({
      ownerId: "first",
      leaseTimeoutMs: 30_000,
    });
    await expect(
      control.acquireHumanControl({ ownerId: "second", leaseTimeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: "human_controlled" });

    control.destroy();
    expect(() => lease.release()).not.toThrow();
    expect(control.snapshot()).toMatchObject({ availability: "destroyed" });
  });

  it("clears pending human state synchronously when destroyed", async () => {
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const acquiring = control.acquireHumanControl({
      ownerId: "viewer",
      leaseTimeoutMs: 30_000,
    });

    control.destroy();
    expect(control.snapshot()).toMatchObject({
      availability: "destroyed",
      humanPending: false,
    });
    await expect(acquiring).rejects.toMatchObject({ code: "runtime_destroyed" });
    finishAction?.();
    await action;
  });

  it("treats destroyed availability as a terminal transition", async () => {
    const control = new BrowserControlState();

    control.setAvailability("destroyed");

    expect(control.snapshot()).toMatchObject({ availability: "destroyed" });
    await expect(control.runAgentAction(async () => undefined)).rejects.toMatchObject({
      code: "runtime_destroyed",
    });
    await expect(
      control.acquireHumanControl({ ownerId: "late", leaseTimeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: "runtime_destroyed" });
  });

  it("clears pending control and blocks new work when the runtime disconnects", async () => {
    const control = new BrowserControlState();
    let finishAction: (() => void) | undefined;
    const action = control.runAgentAction(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );
    const acquiring = control.acquireHumanControl({
      ownerId: "viewer",
      leaseTimeoutMs: 30_000,
    });

    control.setAvailability("disconnected");
    await expect(acquiring).rejects.toMatchObject({ code: "connection_closed" });
    expect(control.snapshot()).toMatchObject({
      availability: "disconnected",
      humanPending: false,
    });
    await expect(control.runAgentAction(async () => undefined)).rejects.toMatchObject({
      code: "connection_closed",
    });
    await expect(
      control.acquireHumanControl({ ownerId: "late", leaseTimeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: "connection_closed" });
    finishAction?.();
    await action;
  });
});
