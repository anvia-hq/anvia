import { describe, expect, it } from "vitest";
import { BrowserControlState } from "../src/control";

describe("BrowserControlState", () => {
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
      code: "human_controlled",
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
    const control = new BrowserControlState();
    const lease = await control.acquireHumanControl({ ownerId: "viewer", leaseTimeoutMs: 20 });
    const firstExpiration = lease.expiresAt;
    lease.renew({ leaseTimeoutMs: 100 });
    expect(Date.parse(lease.expiresAt)).toBeGreaterThanOrEqual(Date.parse(firstExpiration));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(control.snapshot()).toEqual({ mode: "agent" });
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
});
