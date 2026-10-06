import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableRuntime, defineTask } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableTaskHandle, TaskRecord, TaskEvent } from "../src/index.js";
import { done, makeAgent, lookup, toolResponse } from "./helpers.js";
import type { DurableTransaction } from "../src/types.js";

const runtimes: DurableRuntime[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function database() {
  const dir = await mkdtemp(join(tmpdir(), "anvia-tasks-"));
  folders.push(dir);
  return join(dir, "tasks.sqlite");
}
async function open(
  options: Omit<Parameters<typeof DurableRuntime.open>[0], "store">,
  path = ":memory:",
) {
  const runtime = await DurableRuntime.open({ ...options, store: new SqliteDurableStore(path) });
  runtimes.push(runtime);
  return runtime;
}
async function state(handle: DurableTaskHandle<unknown>, status: TaskRecord["status"]) {
  await expect.poll(async () => (await handle.snapshot()).task.status).toBe(status);
  return (await handle.snapshot()).task;
}
const increment = defineTask({
  name: "increment",
  version: 1,
  input: z.number(),
  checkpoint: z.literal("run"),
  output: z.number(),
  initial: () => "run" as const,
  run: async ({ input }) => ({ status: "completed", output: input + 1 }),
});

describe("durable task orchestration", () => {
  it("propagates cancellation of an approval-paused owned agent to its waiting parent", async () => {
    const parent = defineTask({
      name: "approval-parent",
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
              ids: [ctx.spawnAgent("agent", { agentId: "researcher", prompt: "approval" })],
              policy: "allSettled",
            },
          };
        return { status: "completed", output: ctx.children()[0]!.status };
      },
    });
    const runtime = await open({
      tasks: [parent],
      agents: [
        {
          agent: makeAgent(
            async () => toolResponse(),
            [{ ...lookup(async () => "ok"), requiresApproval: true }],
          ),
          version: "1",
        },
      ],
    });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "approval",
      input: null,
    });
    await expect
      .poll(async () => (await handle.graph()).nodes[1]?.wait)
      .toMatchObject({ type: "agent", status: "waiting" });
    const runId = (await handle.graph()).nodes[1]!.agentRunId!;
    await (await runtime.getRun(runId)).cancel();
    expect(await handle.result()).toBe("cancelled");
  });

  it.each(["manual", "safe", "idempotent"] as const)(
    "keeps a successful %s effect with non-JSON output available for reconciliation",
    async (policy) => {
      let calls = 0;
      const task = defineTask({
        name: "invalid-result",
        version: 1,
        input: z.null(),
        checkpoint: z.null(),
        output: z.number(),
        initial: () => null,
        run: async (ctx) => ({
          status: "completed",
          output: await ctx.effect(
            "write",
            null,
            async () => {
              calls++;
              return NaN;
            },
            policy,
          ),
        }),
      });
      const runtime = await open({ tasks: [task] });
      const handle = await runtime.submitTask(task, {
        sessionId: "s",
        requestId: "invalid",
        input: null,
      });
      await state(handle, "needs_attention");
      await handle.resolveEffect("write", 42);
      expect(await handle.result()).toBe(42);
      expect(calls).toBe(1);
    },
  );

  it("executes owned agent children without holding custom phase capacity", async () => {
    const parent = defineTask({
      name: "research",
      version: 1,
      input: z.string(),
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
              ids: [ctx.spawnAgent("research", { agentId: "researcher", prompt: ctx.input })],
              policy: "allSettled",
            },
          };
        const child = ctx.children()[0]!;
        return child.outcome?.status === "completed"
          ? { status: "completed", output: String(child.outcome.output) }
          : { status: "failed", error: "Research failed" };
      },
    });
    const runtime = await open({
      tasks: [parent],
      agents: [{ agent: makeAgent(async () => done()), version: "1" }],
      maxConcurrentTasks: 1,
      maxConcurrentRuns: 1,
    });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "research",
      input: "research",
    });
    expect(await handle.result()).toBe("done");
    const child = (await handle.graph()).nodes[1]!;
    expect(child.agentRunId).toBeTypeOf("string");
    expect((await (await runtime.getRun(child.agentRunId!)).snapshot()).run.status).toBe(
      "completed",
    );
    await expect((await runtime.getRun(child.agentRunId!)).retry()).rejects.toThrow("immutable");
  });

  it("yields and schedules other ready work during repeated pending transitions", async () => {
    let iterations = 0;
    const spinner = defineTask({
      name: "spinner",
      version: 1,
      input: z.null(),
      checkpoint: z.number(),
      output: z.null(),
      initial: () => 0,
      run: async (ctx) => {
        iterations++;
        return { status: "pending", checkpoint: ctx.checkpoint + 1 };
      },
    });
    const runtime = await open({ tasks: [spinner, increment], maxConcurrentTasks: 1 });
    const first = await runtime.submitTask(spinner, {
      sessionId: "s",
      requestId: "spin",
      input: null,
    });
    const second = await runtime.submitTask(increment, {
      sessionId: "s",
      requestId: "increment",
      input: 3,
    });
    expect(await second.result()).toBe(4);
    expect(iterations).toBeGreaterThan(0);
    await first.cancel();
    await expect(first.result()).rejects.toThrow("cancelled");
  });

  it("rejects invalid names, prototype signal keys, non-JSON values, and transforming persistence schemas", async () => {
    expect(() => defineTask({ ...increment, name: " invalid" })).toThrow("trimmed");
    const transformed = defineTask({
      ...increment,
      name: "transform",
      input: z.number().transform((n) => n + 1),
    });
    const runtime = await open({ tasks: [transformed, increment] });
    await expect(
      runtime.submitTask(transformed, { sessionId: "s", requestId: "t", input: 1 }),
    ).rejects.toThrow("round-trip");
    await expect(
      runtime.submitTask(increment, { sessionId: "s", requestId: "bad", input: NaN }),
    ).rejects.toThrow("JSON");
    const handle = await runtime.submitTask(increment, {
      sessionId: "s",
      requestId: "ok",
      input: 1,
    });
    await expect(handle.signal("__proto__", "r", true)).rejects.toThrow("Reserved");
  });

  it.each(["started", "completed"] as const)(
    "makes %s effect persistence failures fatal while draining concurrent effects",
    async (status) => {
      class FailingStore extends SqliteDurableStore {
        override transaction<T>(callback: Parameters<SqliteDurableStore["transaction"]>[0]): T {
          return super.transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(target, key) {
                  if (key === "putOperation")
                    return (...args: Parameters<DurableTransaction["putOperation"]>) => {
                      if (args[1].key === "write" && args[1].status === status)
                        throw new Error("disk failed");
                      return target.putOperation(...args);
                    };
                  return Reflect.get(target, key);
                },
              }),
            ),
          ) as T;
        }
      }
      let caught = false;
      let invoked = false;
      const task = defineTask({
        name: "catch",
        version: 1,
        input: z.null(),
        checkpoint: z.null(),
        output: z.null(),
        initial: () => null,
        run: async (ctx) => {
          try {
            await Promise.all([
              ctx.effect(
                "pending",
                null,
                async (_id, signal) =>
                  await new Promise<null>((_resolve, reject) =>
                    signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
                  ),
              ),
              ctx.effect("write", null, async () => {
                invoked = true;
                return null;
              }),
            ]);
          } catch {
            caught = true;
          }
          return { status: "completed", output: null };
        },
      });
      const runtime = await DurableRuntime.open({
        store: new FailingStore(":memory:"),
        tasks: [task],
      });
      runtimes.push(runtime);
      const handle = await runtime.submitTask(task, {
        sessionId: "s",
        requestId: "catch",
        input: null,
      });
      await expect(handle.result()).rejects.toThrow("storage failed");
      expect(caught).toBe(true);
      expect(invoked).toBe(status === "completed");
    },
  );
  it("joins dynamically created children at concurrency one and retains its exposed graph", async () => {
    const parent = defineTask({
      name: "sum",
      version: 1,
      input: z.array(z.number()),
      checkpoint: z.enum(["spawn", "sum"]),
      output: z.number(),
      initial: () => "spawn" as const,
      run: async (ctx) => {
        if (ctx.checkpoint === "spawn") {
          const ids = ctx.input.map((input, index) => ctx.spawn(String(index), increment, input));
          return {
            status: "waiting",
            checkpoint: "sum" as const,
            wait: { type: "children", ids, policy: "allSettled" },
          };
        }
        const total = ctx
          .children()
          .reduce(
            (sum, child) =>
              sum + (child.outcome?.status === "completed" ? Number(child.outcome.output) : 0),
            0,
          );
        return { status: "completed", output: total };
      },
    });
    const runtime = await open({ tasks: [parent, increment], maxConcurrentTasks: 1 });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "sum",
      input: [1, 2],
    });
    expect(await handle.result()).toBe(5);
    const graph = await handle.graph();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.every((node) => node.status === "completed")).toBe(true);
    expect(graph.edges.filter((edge) => edge.type === "owns")).toHaveLength(2);
    const events: TaskEvent[] = [];
    for await (const event of handle.stream()) events.push(event);
    expect(new Set(events.map((event) => event.taskId)).size).toBe(3);
    expect(events.every((event, i) => i === 0 || event.sequence > events[i - 1]!.sequence)).toBe(
      true,
    );
    expect(
      (await runtime.submitTask(parent, { sessionId: "s", requestId: "sum", input: [1, 2] })).id,
    ).toBe(handle.id);
    await expect(
      runtime.submitTask(parent, { sessionId: "s", requestId: "sum", input: [3] }),
    ).rejects.toThrow("different submission");
    await expect(handle.retry()).rejects.toThrow("immutable");
  });

  it("holds parent completion until every child settles without occupying its slot", async () => {
    const parent = defineTask({
      name: "parent",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => {
        ctx.spawn("child", increment, 2);
        return { status: "completed", output: "parent" };
      },
    });
    const runtime = await open({ tasks: [parent, increment], maxConcurrentTasks: 1 });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "parent",
      input: null,
    });
    expect(await handle.result()).toBe("parent");
    expect((await handle.graph()).nodes[1]!.outcome).toEqual({ status: "completed", output: 3 });
  });

  it("persists timer and early signal delivery across reopening", async () => {
    const path = await database();
    const task = defineTask({
      name: "wait",
      version: 1,
      input: z.string(),
      checkpoint: z.enum(["timer", "signal", "done"]),
      output: z.string(),
      initial: () => "timer" as const,
      run: async (ctx) => {
        if (ctx.checkpoint === "timer")
          return {
            status: "waiting",
            checkpoint: "signal" as const,
            wait: { type: "timer", until: ctx.input },
          };
        if (ctx.checkpoint === "signal")
          return {
            status: "waiting",
            checkpoint: "done" as const,
            wait: { type: "signal", name: "approval" },
          };
        return { status: "completed", output: String(ctx.signalValue("approval")) };
      },
    });
    const runtime = await open({ tasks: [task], maxConcurrentTasks: 1 }, path);
    const handle = await runtime.submitTask(task, {
      sessionId: "s",
      requestId: "wait",
      input: new Date(Date.now() + 250).toISOString(),
    });
    await state(handle, "waiting");
    await handle.signal("approval", "delivery", "yes");
    await handle.signal("approval", "delivery", "yes");
    await expect(handle.signal("approval", "delivery", "no")).rejects.toThrow("different delivery");
    await runtime.close();
    const reopened = await open({ tasks: [task] }, path);
    await reopened.resume();
    expect(await (await reopened.getTask(handle.id)).result()).toBe("yes");
  });

  it("reconciles an uncertain manual effect and reuses its committed result", async () => {
    const path = await database();
    let calls = 0;
    const task = defineTask({
      name: "charge",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => ({
        status: "completed",
        output: await ctx.effect("charge", { amount: 10 }, async (_id, signal) => {
          calls++;
          return await new Promise<string>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        }),
      }),
    });
    const runtime = await open({ tasks: [task] }, path);
    const handle = await runtime.submitTask(task, {
      sessionId: "s",
      requestId: "charge",
      input: null,
    });
    await expect.poll(() => calls).toBe(1);
    await runtime.close();
    const reopened = await open({ tasks: [task] }, path);
    await reopened.resume();
    const recovered = await reopened.getTask(handle.id);
    await state(recovered, "needs_attention");
    expect(calls).toBe(1);
    await recovered.resolveEffect("charge", "receipt-verified");
    expect(await recovered.result()).toBe("receipt-verified");
    expect(calls).toBe(1);
  });

  it("replays from a committed checkpoint and migrates older task versions", async () => {
    const path = await database();
    const version1 = defineTask({
      name: "migration",
      version: 1,
      input: z.number(),
      checkpoint: z.number(),
      output: z.number(),
      initial: () => 0,
      run: async () => ({
        status: "waiting",
        checkpoint: 10,
        wait: { type: "signal", name: "continue" },
      }),
    });
    const runtime = await open({ tasks: [version1] }, path);
    const handle = await runtime.submitTask(version1, { sessionId: "s", requestId: "m", input: 2 });
    await state(handle, "waiting");
    await runtime.close();
    const version2 = defineTask({
      name: "migration",
      version: 2,
      input: z.number(),
      checkpoint: z.object({ count: z.number() }),
      output: z.number(),
      initial: () => ({ count: 0 }),
      migrate: (input, checkpoint, fromVersion) => {
        expect(fromVersion).toBe(1);
        return { input: Number(input), checkpoint: { count: Number(checkpoint) } };
      },
      run: async (ctx) => ({ status: "completed", output: ctx.input + ctx.checkpoint.count }),
    });
    const reopened = await open({ tasks: [version2] }, path);
    const recovered = await reopened.getTask(handle.id);
    await recovered.signal("continue", "continue-1", true);
    expect(await recovered.result()).toBe(12);
    expect((await recovered.snapshot()).task.version).toBe(2);
  });

  it("fail-fast cancels siblings and waits for callbacks before resuming the parent", async () => {
    let release!: () => void;
    let started = false;
    const slow = defineTask({
      name: "slow",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.null(),
      initial: () => null,
      run: async () => {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: "completed", output: null };
      },
    });
    const failure = defineTask({
      ...slow,
      name: "fail",
      run: async () => ({ status: "failed" as const, error: "declined" }),
    });
    const parent = defineTask({
      name: "checkout",
      version: 1,
      input: z.null(),
      checkpoint: z.boolean(),
      output: z.array(z.string()),
      initial: () => false,
      run: async (ctx) => {
        if (!ctx.checkpoint)
          return {
            status: "waiting",
            checkpoint: true,
            wait: {
              type: "children",
              ids: [ctx.spawn("slow", slow, null), ctx.spawn("fail", failure, null)],
              policy: "failFast",
            },
          };
        return { status: "completed", output: ctx.children().map((child) => child.status) };
      },
    });
    const runtime = await open({ tasks: [parent, slow, failure], maxConcurrentTasks: 3 });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "checkout",
      input: null,
    });
    await expect.poll(() => started).toBe(true);
    await expect
      .poll(async () => (await handle.graph()).nodes.find((node) => node.name === "slow")?.status)
      .toBe("cancelling");
    expect((await handle.snapshot()).task.status).toBe("waiting");
    release();
    expect(await handle.result()).toEqual(["cancelled", "failed"]);
  });

  it("fences late spawns after cancellation and keeps ownership until code settles", async () => {
    let continueRun!: () => void;
    let entered = false;
    let blocked = false;
    const parent = defineTask({
      name: "late",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.null(),
      initial: () => null,
      run: async (ctx) => {
        entered = true;
        await new Promise<void>((resolve) => {
          continueRun = resolve;
        });
        try {
          ctx.spawn("late-child", increment, 1);
        } catch {
          blocked = true;
        }
        return { status: "completed", output: null };
      },
    });
    const runtime = await open({ tasks: [parent, increment] });
    const handle = await runtime.submitTask(parent, {
      sessionId: "s",
      requestId: "late",
      input: null,
    });
    await expect.poll(() => entered).toBe(true);
    await handle.cancel();
    expect((await handle.snapshot()).task.status).toBe("cancelling");
    continueRun();
    await expect(handle.result()).rejects.toThrow("cancelled");
    expect(blocked).toBe(true);
    expect((await handle.graph()).nodes).toHaveLength(1);
  });
});
