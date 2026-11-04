import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime, type DurableLimits, type DurableRuntime as Runtime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { createDurableHandler, durableBodyLimitWarning } from "../src/durable";
import { done, makeAgent } from "../../durable/test/helpers.js";

const runtimes: Runtime[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "allowed",
  requestId: "one",
  prompt: "hello",
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe("durableBodyLimitWarning", () => {
  it("warns when the body limit is below the payload limit", () => {
    const message = durableBodyLimitWarning(65_536, 1_048_576);
    expect(message).toContain("65536 bytes");
    expect(message).toContain("1048576 bytes");
    expect(message).toContain("413");
  });

  it("warns for the default body limit against the default payload limit", () => {
    expect(durableBodyLimitWarning(65_536, 1_048_576)).toBeDefined();
  });

  it("stays silent when the limits are equal", () => {
    expect(durableBodyLimitWarning(1_048_576, 1_048_576)).toBeUndefined();
  });

  it("stays silent when the body limit is above the payload limit", () => {
    expect(durableBodyLimitWarning(2_000_000, 1_048_576)).toBeUndefined();
  });

  it("stays silent when the runtime does not report a payload limit", () => {
    expect(durableBodyLimitWarning(65_536, undefined)).toBeUndefined();
  });
});

async function open(limits: Partial<DurableLimits>) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
    limits,
  });
  runtimes.push(runtime);
  return runtime;
}

describe("createDurableHandler startup warning", () => {
  it("emits one warning at creation for a default body limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = await open({});
    createDurableHandler({ runtime, authorize: () => true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("maxBodyBytes");
  });

  it("does not warn when maxBodyBytes covers the payload limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = await open({});
    createDurableHandler({ runtime, authorize: () => true, maxBodyBytes: 2_000_000 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never throws when the runtime cannot report its limits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = {} as Runtime;
    expect(() => createDurableHandler({ runtime, authorize: () => true })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("createDurableHandler Retry-After", () => {
  it("sends Retry-After on capacity 429 and not on payload 413", async () => {
    const model = vi.fn(
      async (_request: unknown, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    );
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(":memory:"),
      agents: [{ agent: makeAgent(model), version: "1" }],
      limits: { maxPayloadBytes: 1_000, maxPendingRuns: 1 },
    });
    runtimes.push(runtime);
    const handler = createDurableHandler({ runtime, authorize: () => true, maxBodyBytes: 65_536 });
    const post = (body: unknown) =>
      handler(
        new Request("http://anvia.test/durable/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    // Payload probes run first: the pending-run cap would otherwise answer them with 429.
    const payload = await post({ ...submission, requestId: "three", prompt: "x".repeat(3_000) });
    expect(payload.status).toBe(413);
    expect(payload.headers.has("retry-after")).toBe(false);
    expect(await payload.json()).toMatchObject({ code: "payload_too_large" });

    const oversizedBody = await post({
      ...submission,
      requestId: "four",
      prompt: "x".repeat(70_000),
    });
    expect(oversizedBody.status).toBe(413);
    expect(oversizedBody.headers.has("retry-after")).toBe(false);

    expect((await post(submission)).status).toBe(202);
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));

    const capacity = await post({ ...submission, sessionId: "other", requestId: "two" });
    expect(capacity.status).toBe(429);
    const retryAfter = capacity.headers.get("retry-after");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    expect(await capacity.json()).toMatchObject({ code: "capacity_exceeded" });
  });
});
