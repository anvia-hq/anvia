import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTask, DurableRuntime } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { done, makeAgent } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";
import { waiting } from "./task-fixtures.js";

type Pool = ReturnType<typeof testPool>["pool"];
type Options = Partial<Parameters<typeof DurableRuntime.open>[0]>;

const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close().catch(() => undefined);
});

async function worker(pool: Pool, options: Options = {}) {
  const runtime = await DurableRuntime.open({
    store: new PostgresDurableStore({ pool }, { schema: "create" }),
    worker: { heartbeatMs: 20 },
    pollIntervalMs: 20,
    ...options,
  });
  runtimes.push(runtime);
  return runtime;
}

const researcher = () => ({ agent: makeAgent(async () => done()), version: "1" });

const submission = (request: string) => ({ sessionId: "s", requestId: request, input: null });

describe("custom tasks with shared workers", () => {
  it("divides root tasks between workers and runs each exactly once", async () => {
    const { pool } = testPool();
    let runs = 0;
    const counted = defineTask({
      name: "counted",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async () => {
        runs++;
        return { status: "completed", output: "ok" };
      },
    });
    const a = await worker(pool, { tasks: [counted] });
    const b = await worker(pool, { tasks: [counted] });
    const handles = [];
    for (let index = 0; index < 6; index++)
      handles.push(await (index % 2 === 0 ? a : b).submitTask(counted, submission(`t${index}`)));
    for (const handle of handles) expect(await handle.result()).toBe("ok");
    expect(runs).toBe(6);
  });

  it("only claims tasks whose definition the worker registers", async () => {
    const { pool } = testPool();
    let ranOn = "";
    const make = (name: string) =>
      defineTask({
        name,
        version: 1,
        input: z.null(),
        checkpoint: z.null(),
        output: z.string(),
        initial: () => null,
        run: async () => {
          ranOn = name;
          return { status: "completed", output: name };
        },
      });
    const wanted = make("wanted");
    const other = make("other");
    await worker(pool, { tasks: [other] });
    const submitter = await worker(pool, { tasks: [wanted] });
    const handle = await submitter.submitTask(wanted, submission("x"));
    expect(await handle.result()).toBe("wanted");
    expect(ranOn).toBe("wanted");
  });

  it("runs a task that waits on an owned agent run", async () => {
    const { pool } = testPool();
    const delegating = defineTask({
      name: "delegating",
      version: 1,
      input: z.null(),
      checkpoint: z.boolean(),
      output: z.string(),
      initial: () => false,
      run: async (ctx) => {
        if (!ctx.checkpoint)
          return {
            status: "waiting",
            checkpoint: true,
            wait: {
              type: "children",
              ids: [await ctx.spawnAgent("agent", { agentId: "researcher", prompt: "hi" })],
              policy: "allSettled",
            },
          };

        return { status: "completed", output: (await ctx.children())[0]!.status };
      },
    });
    const a = await worker(pool, { tasks: [delegating], agents: [researcher()] });
    await worker(pool, { agents: [researcher()] });
    const handle = await a.submitTask(delegating, submission("agent"));
    // Whichever worker ran the owned run, the task settles from the run's outcome.
    expect(await handle.result()).toBe("completed");
  });

  it("settles many task trees across three workers without losing or repeating work", async () => {
    const { pool } = testPool();
    let leaves = 0;
    const leaf = defineTask({
      name: "leaf",
      version: 1,
      input: z.number(),
      checkpoint: z.null(),
      output: z.number(),
      initial: () => null,
      run: async (ctx) => {
        leaves++;
        return { status: "completed", output: ctx.input * 2 };
      },
    });
    const tree = defineTask({
      name: "tree",
      version: 1,
      input: z.number(),
      checkpoint: z.boolean(),
      output: z.number(),
      initial: () => false,
      run: async (ctx) => {
        if (!ctx.checkpoint) {
          const ids = [
            await ctx.spawn("a", leaf, ctx.input),
            await ctx.spawn("b", leaf, ctx.input + 1),
            await ctx.spawnAgent("agent", { agentId: "researcher", prompt: "hi" }),
          ];
          return {
            status: "waiting",
            checkpoint: true,
            wait: { type: "children", ids, policy: "allSettled" },
          };
        }

        const children = await ctx.children();
        return {
          status: "completed",
          output: children.filter((child) => child.status === "completed").length,
        };
      },
    });
    const workers = await Promise.all(
      [0, 1, 2].map(() => worker(pool, { tasks: [tree, leaf], agents: [researcher()] })),
    );
    const handles = [];
    for (let index = 0; index < 12; index++)
      handles.push(
        await workers[index % 3]!.submitTask(tree, {
          sessionId: "s",
          requestId: `tree-${index}`,
          input: index,
        }),
      );
    for (const handle of handles) expect(await handle.result()).toBe(3);
    expect(leaves).toBe(24);
  }, 60_000);

  it("delivers a signal from another worker", async () => {
    const { pool } = testPool();
    const a = await worker(pool, { tasks: [waiting] });
    const b = await worker(pool, { tasks: [waiting] });
    const handle = await a.submitTask(waiting, submission("signal"));
    await vi.waitFor(async () => expect((await handle.snapshot()).task.status).toBe("waiting"));
    await (await b.getTask(handle.id)).signal("go", "r1", null);
    expect(await handle.result()).toBe("done");
  });

  it("claims tasks whose stored text is hostile to a name filter", async () => {
    const { pool } = testPool();
    const echo = defineTask({
      name: "echo",
      version: 1,
      input: z.string(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => ({ status: "completed", output: ctx.input }),
    });
    const other = defineTask({
      name: "other",
      version: 1,
      input: z.string(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => ({ status: "completed", output: `other:${ctx.input}` }),
    });
    const a = await worker(pool, { tasks: [echo, other] });
    await worker(pool, { tasks: [echo] });
    // An escaped NUL and a lone surrogate make jsonb reject the whole record, and a session id or
    // input that looks like the `name` key must not be mistaken for it.
    const hostile = ["a\u0000b", "lone\ud800surrogate", '"name":"other"', '\\"name\\":\\"other\\"'];
    const handles = [];
    for (const [index, input] of hostile.entries())
      handles.push(
        await a.submitTask(echo, {
          sessionId: `s"name":"other${index}`,
          requestId: `k\\${index}`,
          input,
        }),
      );
    const decoy = await a.submitTask(other, { sessionId: "d", requestId: "d", input: "x" });
    for (const [index, handle] of handles.entries())
      expect(await handle.result()).toBe(hostile[index]);
    expect(await decoy.result()).toBe("other:x");
  });

  it("stores a task's name before any nested value, which the claim query relies on", async () => {
    const { pool } = testPool();
    const echo = defineTask({
      name: "echo",
      version: 1,
      input: z.string(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => ({ status: "completed", output: ctx.input }),
    });
    const runtime = await worker(pool, { tasks: [echo] });
    const handle = await runtime.submitTask(echo, {
      sessionId: "s",
      requestId: "order",
      input: '{"name":"decoy"}',
    });
    await handle.result();
    const rows = (await pool.query("SELECT record FROM anvia_durable_tasks")).rows as {
      record: string;
    }[];
    const record = rows[0]!.record;
    const keys = Object.keys(JSON.parse(record) as Record<string, unknown>);
    const before = keys.slice(0, keys.indexOf("name"));
    expect(keys).toContain("name");
    expect(
      before.every(
        (key) => typeof (JSON.parse(record) as Record<string, unknown>)[key] !== "object",
      ),
    ).toBe(true);
    expect(record.indexOf('"name":"')).toBeLessThan(record.indexOf('"input"'));
    // The claim query reads these four fields as one run of adjacent keys.
    expect(record).toMatch(/"name":"echo","version":1,"submissionVersion":1,"submissionInput":/);
  });

  it("keeps every signal delivered concurrently from different workers", async () => {
    const { pool } = testPool();
    const names = Array.from({ length: 10 }, (_, index) => `s${index}`);
    const gather = defineTask({
      name: "gather",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => {
        for (const name of names)
          if ((await ctx.signalValue(name)) === undefined)
            return { status: "waiting", checkpoint: null, wait: { type: "signal", name } };
        return { status: "completed", output: "all" };
      },
    });
    const workers = await Promise.all([0, 1, 2].map(() => worker(pool, { tasks: [gather] })));
    const handle = await workers[0]!.submitTask(gather, submission("gather"));
    await vi.waitFor(async () => expect((await handle.snapshot()).task.status).toBe("waiting"));
    // Each delivery reads and rewrites the task's signal map; unserialised, one would be lost.
    await Promise.all(
      names.map(async (name, index) =>
        (await workers[index % 3]!.getTask(handle.id)).signal(name, `r-${name}`, index),
      ),
    );
    expect(Object.keys((await handle.snapshot()).task.signals).sort()).toEqual([...names].sort());
    expect(await handle.result()).toBe("all");
  });

  it("wakes a timer wait without an in-process timer", async () => {
    const { pool } = testPool();
    const timer = defineTask({
      name: "timer",
      version: 1,
      input: z.string(),
      checkpoint: z.boolean(),
      output: z.string(),
      initial: () => false,
      run: async (ctx) =>
        ctx.checkpoint
          ? { status: "completed", output: "woke" }
          : { status: "waiting", checkpoint: true, wait: { type: "timer", until: ctx.input } },
    });
    await worker(pool, { tasks: [timer] });
    const submitter = await worker(pool, { tasks: [timer] });
    const handle = await submitter.submitTask(timer, {
      sessionId: "s",
      requestId: "t",
      input: new Date(Date.now() + 300).toISOString(),
    });
    expect(await handle.result()).toBe("woke");
  });

  it("resumes a task on another worker after its worker closes", async () => {
    const { pool } = testPool();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const make = (blocked: boolean) =>
      defineTask({
        name: "resumable",
        version: 1,
        input: z.null(),
        checkpoint: z.null(),
        output: z.string(),
        initial: () => null,
        run: async (ctx) => {
          started++;

          if (blocked)
            await new Promise<void>((resolve, reject) => {
              void gate.then(resolve);
              ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
            });

          return { status: "completed", output: blocked ? "first" : "second" };
        },
      });
    const first = make(true);
    const a = await worker(pool, { tasks: [first], worker: { workerId: "a", leaseMs: 600_000 } });
    const handle = await a.submitTask(first, submission("resume"));
    await vi.waitFor(() => expect(started).toBe(1));
    await a.close(); // releases the claim at once instead of waiting out the lease
    const b = await worker(pool, { tasks: [make(false)] });
    expect(await (await b.getTask(handle.id)).result()).toBe("second");
    release();
  });

  it("stops a running task when another worker cancels it", async () => {
    const { pool } = testPool();
    let aborted = false;
    let started = false;
    const blocking = defineTask({
      name: "blocking",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => {
        started = true;
        await new Promise<void>((_resolve, reject) =>
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            reject(ctx.signal.reason);
          }),
        );
        return { status: "completed", output: "never" };
      },
    });
    const a = await worker(pool, { tasks: [blocking] });
    const b = await worker(pool);
    const handle = await a.submitTask(blocking, submission("cancel"));
    await vi.waitFor(() => expect(started).toBe(true));
    await (await b.getTask(handle.id)).cancel();
    await vi.waitFor(() => expect(aborted).toBe(true));
    await expect(handle.result()).rejects.toThrow(/cancelled/);
  });
});
