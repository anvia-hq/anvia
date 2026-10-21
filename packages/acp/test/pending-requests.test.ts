import { describe, expect, it, vi } from "vitest";
import { PendingRequests } from "../src/pending-requests.js";
import { deferred } from "./helpers.js";

describe("pending editor request reservations", () => {
  it("enforces per-session capacity before dispatch, releases on settlement, and stays isolated", async () => {
    const requests = new PendingRequests(1);
    const otherSession = new PendingRequests(1);
    const gate = deferred<string>();
    const first = requests.run(() => gate.promise);
    const extra = vi.fn(async () => "extra");
    await expect(requests.run(extra)).rejects.toMatchObject({ kind: "resource_limit" });
    expect(extra).not.toHaveBeenCalled();
    await expect(otherSession.run(async () => "other")).resolves.toBe("other");
    gate.resolve("first");
    await expect(first).resolves.toBe("first");
    expect(requests.size).toBe(0);
    await expect(requests.run(extra)).resolves.toBe("extra");
    await expect(
      requests.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(
      requests.run(() => {
        throw new Error("synchronous");
      }),
    ).rejects.toThrow("synchronous");
    expect(requests.size).toBe(0);
  });

  it("rejects pending work on close and ignores late replies", async () => {
    const requests = new PendingRequests(1);
    const gate = deferred<string>();
    let signal!: AbortSignal;
    const pending = requests.run((value) => {
      signal = value;
      return gate.promise;
    });
    requests.close();
    requests.close();
    expect(signal.aborted).toBe(true);
    expect(requests.size).toBe(0);
    gate.resolve("late approval");
    await expect(pending).rejects.toMatchObject({ kind: "connection_closed" });
    const next = vi.fn(async () => "no");
    await expect(requests.run(next)).rejects.toMatchObject({ kind: "connection_closed" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not deliver a queued successful reply after shutdown", async () => {
    const requests = new PendingRequests(1);
    const result = requests.run(async () => "already resolved");
    requests.close();
    await expect(result).rejects.toMatchObject({ kind: "connection_closed" });
  });
});
