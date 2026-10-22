import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopControlLock } from "../src/daemon/desktop/control";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DesktopControlLock", () => {
  it("starts unheld, so the agent may act", async () => {
    const lock = new DesktopControlLock();
    expect(lock.snapshot()).toEqual({ held: false });
    await expect(lock.assertAgentInput()).resolves.toBeUndefined();
  });

  it("blocks agent input with a typed error while a human holds control", async () => {
    const lock = new DesktopControlLock();
    const snapshot = lock.takeover("alice");
    expect(snapshot).toMatchObject({ held: true, holder: "alice" });
    expect(Date.parse(snapshot.expiresAt ?? "")).toBeGreaterThan(Date.now());
    await expect(lock.assertAgentInput()).rejects.toMatchObject({
      code: "desktop_locked",
      details: { holder: "alice" },
    });
  });

  it("restores agent input on release", async () => {
    const lock = new DesktopControlLock();
    lock.takeover("alice");
    expect(lock.release("alice")).toEqual({ held: false });
    await expect(lock.assertAgentInput()).resolves.toBeUndefined();
  });

  it("lets the holder renew, but not another holder take over", () => {
    const lock = new DesktopControlLock({ leaseMs: 1_000 });
    lock.takeover("alice");
    vi.advanceTimersByTime(800);
    const renewed = lock.takeover("alice");
    expect(Date.parse(renewed.expiresAt ?? "") - Date.now()).toBe(1_000);
    expect(() => lock.takeover("bob")).toThrow(expect.objectContaining({ code: "desktop_locked" }));
    expect(lock.snapshot().holder).toBe("alice");
  });

  it("lets only the holder release, unless forced", () => {
    const lock = new DesktopControlLock();
    lock.takeover("alice");
    expect(() => lock.release("bob")).toThrow(expect.objectContaining({ code: "desktop_locked" }));
    expect(lock.snapshot().held).toBe(true);
    expect(lock.release("bob", true)).toEqual({ held: false });
    lock.takeover("alice");
    expect(lock.release()).toEqual({ held: false });
  });

  it("lapses when a holder stops renewing, so a vanished viewer cannot lock the agent out", async () => {
    const lock = new DesktopControlLock({ leaseMs: 1_000 });
    lock.takeover("alice");
    vi.advanceTimersByTime(999);
    await expect(lock.assertAgentInput()).rejects.toMatchObject({ code: "desktop_locked" });
    vi.advanceTimersByTime(2);
    expect(lock.snapshot()).toEqual({ held: false });
    await expect(lock.assertAgentInput()).resolves.toBeUndefined();
  });

  it("caps the lease a holder may ask for", () => {
    const lock = new DesktopControlLock({ maxLeaseMs: 5_000 });
    const snapshot = lock.takeover("alice", 10 * 60 * 60 * 1_000);
    expect(Date.parse(snapshot.expiresAt ?? "") - Date.now()).toBe(5_000);
  });

  describe("waiting for release", () => {
    it("lets agent input proceed once the human releases within the wait", async () => {
      const lock = new DesktopControlLock({ waitForReleaseMs: 2_000 });
      lock.takeover("alice");
      const waiting = lock.assertAgentInput();
      vi.advanceTimersByTime(500);
      lock.release("alice");
      await expect(waiting).resolves.toBeUndefined();
    });

    it("fails with desktop_locked when the wait runs out", async () => {
      const lock = new DesktopControlLock({ waitForReleaseMs: 2_000 });
      lock.takeover("alice", 60_000);
      const waiting = lock.assertAgentInput();
      const assertion = expect(waiting).rejects.toMatchObject({ code: "desktop_locked" });
      await vi.advanceTimersByTimeAsync(2_001);
      await assertion;
    });

    it("stops waiting when the caller aborts", async () => {
      const lock = new DesktopControlLock({ waitForReleaseMs: 60_000 });
      lock.takeover("alice");
      const controller = new AbortController();
      const waiting = lock.assertAgentInput(controller.signal);
      const assertion = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await assertion;
    });
  });
});
