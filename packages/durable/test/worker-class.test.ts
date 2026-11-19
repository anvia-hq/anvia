import { afterEach, describe, expect, it } from "vitest";
import { DurableClient, DurableWorker } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

const store = (pool: ReturnType<typeof testPool>["pool"]) =>
  new PostgresDurableStore({ pool }, { schema: "create" });

const registration = () => ({ agent: makeAgent(async () => done()), version: "1" });

describe("DurableWorker", () => {
  it("executes what a client submits and reports its identity and health", async () => {
    const { pool } = testPool();
    const worker = await DurableWorker.start({
      store: store(pool),
      agents: [registration()],
      workerId: "w-1",
      pollIntervalMs: 20,
    });
    closers.push(() => worker.close());
    expect(worker.workerId).toBe("w-1");
    expect(worker.health()).toMatchObject({ status: "ready", ready: true });
    expect(worker.compatibility().map((entry) => entry.agentId)).toEqual(["researcher"]);

    const client = await DurableClient.connect({ store: store(pool) });
    closers.push(() => client.close());
    const run = await client
      .agent<string>("researcher")
      .submit({ sessionId: "s", requestId: "r", prompt: "hi" });
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(await worker.metrics()).toBeDefined();
  });

  it("generates a worker id and has no submit or control methods", async () => {
    const { pool } = testPool();
    const worker = await DurableWorker.start({ store: store(pool), agents: [registration()] });
    closers.push(() => worker.close());
    expect(worker.workerId).toMatch(/^worker-/);
    expect("submit" in worker).toBe(false);
    expect("cancel" in worker).toBe(false);
  });

  it("stops claiming an unregistered agent and resumes when it is registered again", async () => {
    const { pool } = testPool();
    // The long poll interval keeps the first poll from claiming the run before it is unregistered.
    const worker = await DurableWorker.start({
      store: store(pool),
      agents: [registration()],
      pollIntervalMs: 400,
    });
    closers.push(() => worker.close());
    const client = await DurableClient.connect({ store: store(pool) });
    closers.push(() => client.close());
    const run = await client
      .agent<string>("researcher")
      .submit({ sessionId: "s", requestId: "r", prompt: "hi" });

    // Unfinished work in the store does not block unregistering on a shared worker.
    expect(await worker.unregisterAgent("researcher")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await run.status()).toMatchObject({ status: "queued" });

    worker.registerAgents([registration()]);
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("refuses a store that cannot share workers", async () => {
    await expect(
      DurableWorker.start({ store: new SqliteDurableStore(":memory:") }),
    ).rejects.toThrow(/does not support shared workers/);
  });
});
