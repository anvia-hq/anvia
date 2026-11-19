import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime, type DurableWorkerOptions } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

type Pool = ReturnType<typeof testPool>["pool"];
type Completion = (
  request: CompletionRequest,
  signal?: AbortSignal,
) => Promise<ReturnType<typeof done>>;

const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close().catch(() => undefined);
});

async function openWorker(
  pool: Pool,
  completion: Completion,
  worker: DurableWorkerOptions = {},
  extra: { maxConcurrentRuns?: number; pollIntervalMs?: number } = {},
) {
  const options: Parameters<typeof DurableRuntime.open>[0] = {
    store: new PostgresDurableStore({ pool }, { schema: "create" }),
    agents: [{ agent: makeAgent(completion), version: "1" }],
    worker,
    pollIntervalMs: extra.pollIntervalMs ?? 20,
  };
  if (extra.maxConcurrentRuns !== undefined) options.maxConcurrentRuns = extra.maxConcurrentRuns;
  const runtime = await DurableRuntime.open(options);
  runtimes.push(runtime);
  return runtime;
}

const submission = (session: string, request = "r") => ({
  agentId: "researcher",
  sessionId: session,
  requestId: request,
  prompt: "hi",
});

/** A model call that finishes only when told to, or fails when the runtime aborts it. */
function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const state = { started: 0, aborted: false, release };
  const completion: Completion = async (_request, signal) => {
    state.started++;
    await new Promise<void>((resolve, reject) => {
      void open.then(resolve);
      signal?.addEventListener("abort", () => {
        state.aborted = true;
        reject(signal.reason);
      });
    });
    return done();
  };
  return { state, completion };
}

describe("shared worker mode", () => {
  it("divides runs between workers and executes each exactly once", async () => {
    const { pool } = testPool();
    let calls = 0;
    const count: Completion = async () => {
      calls++;
      return done();
    };
    const a = await openWorker(pool, count, {}, { maxConcurrentRuns: 2 });
    const b = await openWorker(pool, count, {}, { maxConcurrentRuns: 2 });
    const runs = [];
    for (let index = 0; index < 6; index++)
      runs.push(await (index % 2 === 0 ? a : b).submit(submission(`s${index}`)));
    for (const run of runs) expect(await run.result()).toMatchObject({ output: "done" });
    expect(calls).toBe(6);
  });

  it("fences a worker whose lease was taken over so it cannot overwrite the result", async () => {
    const { pool } = testPool();
    const slow = gate();
    // The first worker's heartbeat never fires, so its lease lapses while its model call is stuck.
    const stale = await openWorker(
      pool,
      slow.completion,
      { workerId: "stale", leaseMs: 60, heartbeatMs: 60_000 },
      { pollIntervalMs: 60_000 },
    );
    const run = await stale.submit(submission("s"));
    await expect.poll(() => slow.state.started).toBe(1);

    // The fresh worker takes the run over and is still working on it when the stale one returns:
    // only the claim, not the run's status, can reject the stale write.
    const takeover = gate();
    const fresh = await openWorker(pool, takeover.completion, { workerId: "fresh" });
    await expect.poll(() => takeover.state.started).toBe(1);

    slow.state.release(); // the stale worker's attempt now returns, too late
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await fresh.status(run.id)).status).toBe("running"); // its late result was fenced out

    takeover.state.release();
    expect(await (await fresh.getRun(run.id)).result()).toMatchObject({ output: "done" });
    const completions = [];
    for await (const event of (await fresh.getRun(run.id)).stream())
      if (event.type === "status" && (event.data as { status?: string }).status === "completed")
        completions.push(event);
    expect(completions).toHaveLength(1);
    expect(stale.health().status).toBe("ready"); // losing a claim stops one run, not the runtime
  });

  it("stops a run another worker cancelled and never resurrects it", async () => {
    const { pool } = testPool();
    const blocked = gate();
    const a = await openWorker(pool, blocked.completion, { workerId: "a" });
    const b = await openWorker(pool, async () => done(), { workerId: "b" });
    const run = await a.submit(submission("s"));
    await expect.poll(() => blocked.state.started).toBe(1);

    await b.cancel(run.id);

    await expect.poll(() => blocked.state.aborted).toBe(true);
    expect((await a.status(run.id)).status).toBe("cancelled");
    blocked.state.release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await a.status(run.id)).status).toBe("cancelled");
  });

  it("releases its claims on close so another worker takes over at once", async () => {
    const { pool } = testPool();
    const blocked = gate();
    const a = await openWorker(pool, blocked.completion, { workerId: "a", leaseMs: 600_000 });
    const run = await a.submit(submission("s"));
    await expect.poll(() => blocked.state.started).toBe(1);
    await a.close();

    let takenOver = 0;
    const b = await openWorker(
      pool,
      async () => {
        takenOver++;
        return done();
      },
      { workerId: "b" },
    );
    expect(await (await b.getRun(run.id)).result()).toMatchObject({ output: "done" });
    expect(takenOver).toBe(1); // well inside the 10 minute lease a, which never renewed, held
  });

  it("survives transient claim, renew and release failures", async () => {
    const { pool } = testPool();
    const inner = new PostgresDurableStore({ pool }, { schema: "create" });
    const flaky = { claim: 1, renew: 2, release: 1 };
    const store = new Proxy(inner, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        const name = String(key) as keyof typeof flaky;
        return (...args: unknown[]) => {
          if (name in flaky && flaky[name] > 0) {
            flaky[name]--;
            return Promise.reject(new Error(`transient ${name}`));
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
    const { state, completion } = gate();
    const runtime = await DurableRuntime.open({
      store,
      agents: [{ agent: makeAgent(completion), version: "1" }],
      worker: { heartbeatMs: 10, leaseMs: 5_000 },
      pollIntervalMs: 20,
    });
    runtimes.push(runtime);
    const run = await runtime.submit(submission("flaky"));
    await vi.waitFor(() => expect(state.started).toBe(1));
    await vi.waitFor(() => expect(flaky.renew).toBe(0));
    state.release();
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(flaky).toEqual({ claim: 0, renew: 0, release: 0 });
    expect(state.aborted).toBe(false);
  });

  it("refuses unsupported combinations", async () => {
    const { pool } = testPool();
    const worker = await openWorker(pool, async () => done());
    await expect(worker.submitGraph({} as never)).rejects.toThrow(/shared worker mode/);

    await expect(
      DurableRuntime.open({ store: new SqliteDurableStore(":memory:"), worker: {} }),
    ).rejects.toThrow(/does not support shared workers/);
    await expect(
      DurableRuntime.open({
        store: new PostgresDurableStore({ pool }, { schema: "create" }),
        worker: { leaseMs: 0 },
      }),
    ).rejects.toThrow(/worker.leaseMs/);
  });
});
