import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import { DurableRuntime, defineTask } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { z } from "zod";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
async function open(
  path = ":memory:",
  options: Partial<Parameters<typeof DurableRuntime.open>[0]> = {},
) {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path), ...options });
  runtimes.push(runtime);
  return runtime;
}
const input = (agentId: string, sessionId = agentId) => ({
  agentId,
  sessionId,
  requestId: "one",
  prompt: "Hello",
});
const agent = (id: string) => new Agent({ id, model: makeAgent(async () => done()).model });
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("registers another agent while a model is running without aborting or replaying it", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let interrupted = false;
  const completion = vi.fn(async (_request, signal?: AbortSignal) => {
    await Promise.race([
      held,
      new Promise<void>((resolve) =>
        signal?.addEventListener(
          "abort",
          () => {
            interrupted = true;
            resolve();
          },
          { once: true },
        ),
      ),
    ]);
    return done();
  });
  const runtime = await open();
  runtime.registerAgents([{ agent: makeAgent(completion), version: "1" }]);
  const first = await runtime.submit(input("researcher"));
  await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
  runtime.registerAgents([{ agent: agent("second"), version: "1" }]);
  expect((await (await runtime.submit(input("second"))).result()).type).toBe("response");
  expect(interrupted).toBe(false);
  expect(() => runtime.unregisterAgent("researcher")).toThrow("active attempt");
  release();
  await first.result();
  expect(completion).toHaveBeenCalledTimes(1);
});

it("keeps approval registrations pinned while unrelated agents can be added and removed", async () => {
  const approval = { ...lookup(async () => "approved"), requiresApproval: true };
  const runtime = await open();
  runtime.registerAgents([
    {
      agent: makeAgent(
        async (request) => (hasToolResult(request) ? done() : toolResponse()),
        [approval],
      ),
      version: "1",
    },
  ]);
  const pending = await runtime.submit(input("researcher"));
  await vi.waitFor(async () => expect((await pending.snapshot()).run.status).toBe("waiting"));
  expect(() => runtime.unregisterAgent("researcher")).toThrow(/unfinished work|active attempt/);
  runtime.registerAgents([{ agent: agent("other"), version: "1" }]);
  const other = await runtime.submit(input("other"));
  await other.result();
  await vi.waitFor(() => expect(runtime.unregisterAgent("other")).toBe(true));
  expect((await other.snapshot()).run.status).toBe("completed");
  const outcome = (await pending.snapshot()).run.outcome;
  if (outcome?.type !== "interaction") throw new Error("Expected approval");
  await pending.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
  await pending.result();
  await vi.waitFor(() => expect(runtime.unregisterAgent("researcher")).toBe(true));
});

it("validates the complete batch before adding anything and never overwrites existing IDs", async () => {
  const runtime = await open();
  runtime.registerAgents([{ agent: agent("existing"), version: "1" }]);
  expect(() =>
    runtime.registerAgents([
      { agent: agent("new"), version: "1" },
      { agent: agent("existing"), version: "2" },
    ]),
  ).toThrow("already registered");
  await expect(runtime.submit(input("new"))).rejects.toThrow("Unknown durable agent");
  expect(() =>
    runtime.registerAgents([
      { agent: agent("new"), version: "1" },
      { agent: agent("invalid"), version: "" },
    ]),
  ).toThrow();
  expect(() =>
    runtime.registerAgents([
      { agent: agent("new"), version: "1" },
      { agent: agent("new"), version: "1" },
    ]),
  ).toThrow("Duplicate");
  await expect(runtime.submit(input("new"))).rejects.toThrow("Unknown durable agent");
  expect(() =>
    runtime.registerAgents([
      { agent: agent("bad"), version: "1", toolRecovery: { missing: "safe" } },
    ]),
  ).toThrow("Unknown recovery tool");
  expect((await (await runtime.submit(input("existing"))).snapshot()).run.version).toBe("1");
  expect(runtime.unregisterAgent("absent")).toBe(false);
  await runtime.close();
  expect(() => runtime.registerAgents([])).toThrow("closed");
  expect(() => runtime.unregisterAgent("existing")).toThrow("closed");
});

it("restores registrations after open, preserves history, across unloaded configurations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-registration-"));
  directories.push(directory);
  const path = join(directory, "journal.sqlite");
  const first = await open(path);
  first.registerAgents([{ agent: agent("first"), version: "1" }]);
  const run = await first.submit(input("first", "conversation"));
  await run.result();
  await first.close();
  const next = await open(path);
  expect(next.snapshot(run.id).run.status).toBe("completed");
  next.registerAgents([{ agent: agent("second"), version: "1" }]);
  const followup = await next.submit({ ...input("second", "conversation"), requestId: "two" });
  await followup.result();
  expect((await followup.snapshot()).run.history).toHaveLength(2);
});

it("shares added registrations with custom tasks that spawn owned agents", async () => {
  const parent = defineTask({
    name: "parent",
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
            policy: "failFast",
            ids: [ctx.spawnAgent("child", { agentId: "dynamic", prompt: "Hello" })],
          },
        };
      return { status: "completed", output: "done" };
    },
  });
  const runtime = await open(":memory:", { tasks: [parent] });
  runtime.registerAgents([{ agent: agent("dynamic"), version: "1" }]);
  const task = await runtime.submitTask(parent, {
    sessionId: "task",
    requestId: "one",
    input: null,
  });
  expect(await task.result()).toBe("done");
});

it("does not unload a cancelled attempt until its callback has settled", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completion = vi.fn(async () => {
    await held;
    return done();
  });
  const runtime = await open();
  runtime.registerAgents([{ agent: makeAgent(completion), version: "1" }]);
  try {
    const run = await runtime.submit(input("researcher"));
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
    await run.cancel();
    expect((await run.snapshot()).run.status).toBe("cancelled");
    expect(() => runtime.unregisterAgent("researcher")).toThrow("active attempt");
  } finally {
    release();
  }
  await vi.waitFor(() => expect(runtime.unregisterAgent("researcher")).toBe(true));
});

it("leaves missing-version recovery blocked until explicitly retried after registration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-register-recover-"));
  directories.push(directory);
  const path = join(directory, "journal.sqlite");
  const first = await open(path);
  first.registerAgents([
    {
      agent: makeAgent(async (_request, signal) => {
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
        return done();
      }),
      version: "1",
    },
  ]);
  const run = await first.submit(input("researcher"));
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("running"));
  await first.close();
  const next = await open(path);
  await next.resume();
  await vi.waitFor(() => expect(next.snapshot(run.id).run.status).toBe("needs_attention"));
  next.registerAgents([{ agent: makeAgent(async () => done()), version: "1" }]);
  expect(next.snapshot(run.id).run.status).toBe("needs_attention");
  expect(() => next.unregisterAgent("researcher")).toThrow(/unfinished work|active attempt/);
  await vi.waitFor(() => next.retry(run.id));
  expect((await (await next.getRun(run.id)).result()).type).toBe("response");
});

it("replays a completed owned spawn after unloading its registration", async () => {
  const parent = defineTask({
    name: "replay",
    version: 1,
    input: z.null(),
    checkpoint: z.number(),
    output: z.string(),
    initial: () => 0,
    run: async (ctx) => {
      const child = ctx.spawnAgent("child", { agentId: "dynamic", prompt: "Hello" });
      if (ctx.checkpoint === 0)
        return {
          status: "waiting",
          checkpoint: 1,
          wait: { type: "children", ids: [child], policy: "failFast" },
        };
      if (ctx.checkpoint === 1)
        return { status: "waiting", checkpoint: 2, wait: { type: "signal", name: "continue" } };
      return { status: "completed", output: child };
    },
  });
  const runtime = await open(":memory:", { tasks: [parent] });
  runtime.registerAgents([{ agent: agent("dynamic"), version: "1" }]);
  const task = await runtime.submitTask(parent, {
    sessionId: "replay",
    requestId: "one",
    input: null,
  });
  await vi.waitFor(async () =>
    expect((await task.snapshot()).task.wait).toMatchObject({ type: "signal" }),
  );
  const child = (await task.graph()).nodes.find((node) => node.name === "anvia.agent")!;
  await vi.waitFor(() => expect(runtime.unregisterAgent("dynamic")).toBe(true));
  await task.signal("continue", "one", true);
  expect(await task.result()).toBe(child.id);
});
