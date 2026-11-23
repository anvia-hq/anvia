import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTask, DurableClient, DurableRuntime, DurableWorker } from "../src/index.js";
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

    expect(await worker.unregisterAgent("researcher")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await run.status()).toMatchObject({ status: "queued" });

    worker.registerAgents([registration()]);
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("leaves a run it claimed untouched when its agent is unregistered mid-claim", async () => {
    const { pool } = testPool();
    const inner = store(pool);
    let worker: DurableWorker | undefined;
    let unregistered = false;
    const racing = new Proxy(inner, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);

        if (key !== "claim" || typeof value !== "function") return value;

        return async (...args: unknown[]) => {
          const claims = (await Reflect.apply(value, target, args)) as unknown[];

          if (claims.length > 0 && !unregistered) {
            unregistered = true;
            await worker!.unregisterAgent("researcher");
          }

          return claims;
        };
      },
    });
    worker = await DurableWorker.start({
      store: racing,
      agents: [registration()],
      pollIntervalMs: 20,
    });
    closers.push(() => worker!.close());
    const client = await DurableClient.connect({ store: store(pool) });
    closers.push(() => client.close());
    const run = await client
      .agent<string>("researcher")
      .submit({ sessionId: "s", requestId: "r", prompt: "hi" });
    await vi.waitFor(() => expect(unregistered).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await run.status()).toMatchObject({ status: "queued" });

    worker.registerAgents([registration()]);
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("executes tasks a runtime in worker mode submits", async () => {
    const { pool } = testPool();
    const echo = defineTask({
      name: "echo",
      version: 1,
      input: z.string(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => ({ status: "completed", output: `echo:${ctx.input}` }),
    });
    const worker = await DurableWorker.start({
      store: store(pool),
      tasks: [echo],
      pollIntervalMs: 20,
    });
    closers.push(() => worker.close());
    const submitter = await DurableRuntime.open({
      store: store(pool),
      tasks: [echo],
      worker: {},
      pollIntervalMs: 20,
    });
    closers.push(() => submitter.close());
    const handle = await submitter.submitTask(echo, {
      sessionId: "s",
      requestId: "r",
      input: "hi",
    });
    expect(await handle.result()).toBe("echo:hi");
  });

  it("refuses a store that cannot share workers", async () => {
    await expect(
      DurableWorker.start({ store: new SqliteDurableStore(":memory:") }),
    ).rejects.toThrow(/does not support shared workers/);
  });
});
