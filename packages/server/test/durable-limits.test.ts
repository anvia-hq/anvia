import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime, type DurableLimits, type DurableRuntime as Runtime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { createDurableHandler } from "../src/durable";
import { done, makeAgent } from "../../durable/test/helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close();
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

  it.each([1_048_576, 2_000_000])(
    "does not warn when maxBodyBytes (%i) covers the payload limit",
    async (maxBodyBytes) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const runtime = await open({});
      createDurableHandler({ runtime, authorize: () => true, maxBodyBytes });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("never throws when the runtime cannot report its limits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = {} as Runtime;
    expect(() => createDurableHandler({ runtime, authorize: () => true })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
