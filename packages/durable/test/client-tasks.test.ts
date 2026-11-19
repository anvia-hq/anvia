import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTask, DurableClient, DurableRuntime } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { testPool } from "./helpers/postgres.js";
import { waiting } from "./task-fixtures.js";

type Pool = ReturnType<typeof testPool>["pool"];

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

const store = (pool: Pool) => new PostgresDurableStore({ pool }, { schema: "create" });

async function worker(
  pool: Pool,
  tasks: NonNullable<Parameters<typeof DurableRuntime.open>[0]["tasks"]>,
) {
  const runtime = await DurableRuntime.open({
    store: store(pool),
    tasks,
    worker: { heartbeatMs: 20 },
    pollIntervalMs: 20,
  });
  closers.push(() => runtime.close());
  return runtime;
}

async function client(pool: Pool) {
  const value = await DurableClient.connect({ store: store(pool) });
  closers.push(() => value.close());
  return value;
}

const counting = (version = 1) =>
  defineTask({
    name: "counting",
    version,
    input: z.object({ start: z.number() }),
    checkpoint: z.object({ total: z.number() }),
    output: z.number(),
    initial: (input) => ({ total: input.start * 10 }),
    run: async (ctx) => ({ status: "completed", output: ctx.checkpoint.total + 1 }),
  });

describe("tasks from a store-only DurableClient", () => {
  it("submits without the definition and a worker admits and runs the task", async () => {
    const { pool } = testPool();
    const definition = counting();
    const c = await client(pool);
    const handle = await c.submitTask(definition, {
      sessionId: "s",
      requestId: "r",
      input: { start: 4 },
    });
    const before = (await handle.snapshot()).task;
    expect(before).toMatchObject({ unadmitted: true, checkpoint: null, status: "pending" });

    await worker(pool, [definition]);
    // The checkpoint came from the worker's `initial`, which the client never ran.
    expect(await handle.result()).toBe(41);
    const after = (await handle.snapshot()).task;
    expect(after.unadmitted).toBeUndefined();
    expect(after.checkpoint).toEqual({ total: 40 });
  });

  it("fails a task whose input does not parse instead of blocking it", async () => {
    const { pool } = testPool();
    const c = await client(pool);
    await worker(pool, [counting()]);
    const handle = await c.submitRegisteredTask({
      name: "counting",
      version: 1,
      sessionId: "s",
      requestId: "bad",
      input: { start: "four" },
    });
    await expect(handle.result()).rejects.toThrow(/Invalid task input/);
  });

  it("leaves a task waiting until a worker registers its definition", async () => {
    const { pool } = testPool();
    const other = defineTask({
      name: "other",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async () => ({ status: "completed", output: "other" }),
    });
    await worker(pool, [other]);
    const definition = counting();
    const handle = await (
      await client(pool)
    ).submitTask(definition, {
      sessionId: "s",
      requestId: "wait",
      input: { start: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await handle.snapshot()).task.status).toBe("pending");
    await worker(pool, [definition]);
    expect(await handle.result()).toBe(11);
  });

  it("blocks a task whose version no worker registers, with a clear reason", async () => {
    const { pool } = testPool();
    const c = await client(pool);
    await worker(pool, [counting(2)]);
    const handle = await c.submitTask(counting(1), {
      sessionId: "s",
      requestId: "old",
      input: { start: 1 },
    });
    await vi.waitFor(async () =>
      expect((await handle.snapshot()).task).toMatchObject({
        status: "needs_attention",
        error: expect.stringContaining("Task version 1 is not registered on this worker"),
      }),
    );
  });

  it("is idempotent and rejects a different input under the same key", async () => {
    const { pool } = testPool();
    const definition = counting();
    const c = await client(pool);
    const input = { sessionId: "s", requestId: "same", input: { start: 2 } };
    const first = await c.submitTask(definition, input);
    expect((await c.submitTask(definition, input)).id).toBe(first.id);
    await expect(c.submitTask(definition, { ...input, input: { start: 3 } })).rejects.toThrow(
      /different submission/,
    );
  });

  it("signals a waiting task and cancels a running one from the client", async () => {
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
    await worker(pool, [waiting, blocking]);
    const c = await client(pool);

    const gated = await c.submitTask(waiting, { sessionId: "a", requestId: "a", input: null });
    await vi.waitFor(async () => expect((await gated.snapshot()).task.status).toBe("waiting"));
    await gated.signal("go", "r1", null);
    expect(await gated.result()).toBe("done");

    const running = await c.submitTask(blocking, { sessionId: "b", requestId: "b", input: null });
    await vi.waitFor(() => expect(started).toBe(true));
    await running.cancel();
    await vi.waitFor(() => expect(aborted).toBe(true));
    await expect(running.result()).rejects.toThrow(/cancelled/);

    expect((await c.listTasks({ sessionId: "a" })).tasks.map((task) => task.id)).toContain(
      gated.id,
    );
    expect((await c.taskGraph(gated.id)).nodes[0]?.id).toBe(gated.id);
  });
});
