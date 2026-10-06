import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { Agent } from "@anvia/core/agent";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableRun } from "../src/run.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "request",
  prompt: "hello",
};

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, agent = makeAgent(async () => done()), version = "1") {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function status(run: DurableRun, expected: string) {
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe(expected));
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("durable submissions", () => {
  it("deduplicates concurrent submissions, persists outcomes, and reopens without model calls", async () => {
    const path = database();
    const model = vi.fn(async () => done());
    const runtime = await open(path, makeAgent(model));
    const [first, second] = await Promise.all([
      runtime.submit(submission),
      runtime.submit(submission),
    ]);
    expect(first.id).toBe(second.id);
    expect(await first.result()).toMatchObject({ type: "response", output: "done" });
    expect(model).toHaveBeenCalledTimes(1);
    await runtime.close();
    const reopened = await open(path, makeAgent(model));
    const existing = await reopened.submit(submission);
    expect(existing.id).toBe(first.id);
    expect(await existing.result()).toMatchObject({ output: "done" });
    expect(model).toHaveBeenCalledTimes(1);
    await expect(reopened.submit({ ...submission, prompt: "different" })).rejects.toThrow(
      "different submission",
    );
  });

  it("keeps sequential session history and rejects concurrent work in the same session", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = vi.fn(async () => {
      await held;
      return done();
    });
    const runtime = await open(database(), makeAgent(model));
    const first = await runtime.submit(submission);
    await expect(runtime.submit({ ...submission, requestId: "second" })).rejects.toThrow(
      "unfinished work",
    );
    release();
    await first.result();
    const second = await runtime.submit({
      ...submission,
      requestId: "second",
      prompt: "follow up",
    });
    await second.result();
    expect(model.mock.calls).toHaveLength(2);
    expect((await second.snapshot()).run.history).toHaveLength(2);
  });

  it("records approved tool results and passes stable operation IDs to tools", async () => {
    const tool = vi.fn(async (_args, context) => context.operationId);
    const runtime = await open(
      database(),
      makeAgent(
        async (request) => (hasToolResult(request) ? done() : toolResponse()),
        [lookup(tool)],
      ),
    );
    const run = await runtime.submit(submission);
    await run.result();
    expect(tool).toHaveBeenCalledTimes(1);
    expect(tool.mock.calls[0]?.[1].operationId).toBe(`${run.id}/0:tool:1:call-1`);
    const events = [];
    for await (const event of run.stream()) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "submitted",
      "status",
      "model_started",
      "model_completed",
      "tool_started",
      "tool_completed",
      "model_started",
      "model_completed",
      "status",
    ]);
  });

  it("persists an approval across restart and accepts its response only once", async () => {
    const path = database();
    const tool = vi.fn(async () => "approved result");
    const agent = makeAgent(
      async (request) => (hasToolResult(request) ? done() : toolResponse()),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const runtime = await open(path, agent);
    const run = await runtime.submit(submission);
    await status(run, "waiting");
    const pending = (await run.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Missing approval");
    expect(tool).not.toHaveBeenCalled();
    await runtime.close();
    const restarted = await open(path, agent);
    const restored = await restarted.getRun(run.id);
    await restored.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    await restored.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    await expect(
      restored.respond(pending.interaction.id, { type: "tool-approval", approved: false }),
    ).rejects.toThrow("different response");
    await restored.result();
    expect(tool).toHaveBeenCalledTimes(1);
    expect((await restored.snapshot()).run.usage.totalTokens).toBe(6);
    const next = await restarted.submit({ ...submission, requestId: "followup" });
    await next.result();
    expect(
      (await next.snapshot()).run.history.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("detaches a subscriber without cancelling work and reconnects after its snapshot cursor", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await open(
      database(),
      makeAgent(async () => {
        await held;
        return done();
      }),
    );
    const run = await runtime.submit(submission);
    const controller = new AbortController();
    const iterator = run.stream({ abortSignal: controller.signal })[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort(new Error("Disconnected"));
    await expect(iterator.next()).rejects.toThrow("Disconnected");
    const snapshot = await run.snapshot();
    expect(snapshot.run.status).toBe("running");
    release();
    const events = [];
    for await (const event of run.stream({ after: snapshot.cursor })) events.push(event);
    expect(events.every((event) => event.sequence > snapshot.cursor)).toBe(true);
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("persists explicit cancellation and never recovers cancelled work", async () => {
    const path = database();
    const model = vi.fn(
      async (_request, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    );
    const runtime = await open(path, makeAgent(model));
    const run = await runtime.submit(submission);
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    await run.cancel();
    await expect(run.result()).rejects.toMatchObject({ status: "cancelled" });
    await runtime.close();
    const restarted = await open(path, makeAgent(model));
    await restarted.resume();
    expect((await (await restarted.getRun(run.id)).snapshot()).run.status).toBe("cancelled");
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("includes intermediate committed results in a reconnect snapshot", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = vi.fn(async (request) => {
      if (!hasToolResult(request)) return toolResponse();
      await held;
      return done();
    });
    const runtime = await open(database(), makeAgent(model, [lookup(async () => "saved result")]));
    const run = await runtime.submit(submission);
    try {
      await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(2));
      const snapshot = await run.snapshot();
      expect(snapshot.run.status).toBe("running");
      expect(snapshot.operations.find((operation) => operation.kind === "tool")).toMatchObject({
        status: "completed",
        result: { output: { type: "text", value: "saved result" } },
      });
      snapshot.operations.length = 0;
      expect((await run.snapshot()).operations).toHaveLength(3);
      release();
      const events = [];
      for await (const event of run.stream({ after: snapshot.cursor })) events.push(event);
      expect(events.map((event) => event.type)).toEqual(["model_completed", "status"]);
    } finally {
      release();
    }
  });

  it("requires the persisted agent version before recovery", async () => {
    const path = database();
    const original = await open(
      path,
      makeAgent(
        async (_request, signal) =>
          new Promise<never>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
          }),
      ),
    );
    const run = await original.submit(submission);
    await status(run, "running");
    await original.close();
    const restarted = await open(
      path,
      makeAgent(async () => done()),
      "2",
    );
    await restarted.resume();
    const restored = await restarted.getRun(run.id);
    await status(restored, "needs_attention");
    expect((await restored.snapshot()).run.error).toContain("version");
  });

  it("refuses a second live SQLite owner", async () => {
    const path = database();
    await open(path);
    const store = new SqliteDurableStore(path);
    await expect(DurableRuntime.open({ store, agents: [] })).rejects.toThrow("live owner");
    store.close();
  });

  it("retries a failed model request without resetting the durable turn count", async () => {
    const model = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(done());
    const runtime = await open(database(), makeAgent(model));
    const run = await runtime.submit(submission);
    await expect(run.result()).rejects.toMatchObject({ status: "failed" });
    await run.retry();
    expect(await run.result()).toMatchObject({ output: "done" });
    expect((await run.snapshot()).run.modelTurns).toBe(1);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("settles a waiter from its observed failure when another caller immediately retries", async () => {
    const model = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(done());
    const runtime = await open(database(), makeAgent(model));
    const run = await runtime.submit(submission);
    await status(run, "failed");
    const snapshot = run.snapshot.bind(run);
    const observer = vi.spyOn(run, "snapshot").mockImplementationOnce(async () => {
      const failed = await snapshot();
      // Another caller retries after the waiter reads storage, before it consumes that state.
      await run.retry();
      return failed;
    });
    try {
      await expect(run.result()).rejects.toMatchObject({
        status: "failed",
        message: "unavailable",
      });
    } finally {
      observer.mockRestore();
    }
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("enforces the original model-turn budget across approval continuations", async () => {
    const tool = vi.fn(async () => "written");
    const base = makeAgent(
      async () => toolResponse(),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const agent = new Agent({ id: base.id, model: base.model, tools: base.tools, maxTurns: 0 });
    const runtime = await open(database(), agent);
    const run = await runtime.submit(submission);
    await status(run, "waiting");
    const outcome = (await run.snapshot()).run.outcome;
    if (outcome?.type !== "interaction") throw new Error("Missing approval");
    await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
    await expect(run.result()).rejects.toThrow("model-turn budget");
    expect(tool).toHaveBeenCalledTimes(1);
    expect((await run.snapshot()).run.modelTurns).toBe(1);
  });

  it("rejects callbacks without checkpoint support before acquiring the store", async () => {
    const store = new SqliteDurableStore(database());
    const agent = new Agent({
      id: "researcher",
      model: makeAgent(async () => done()).model,
      middlewares: [{}],
    });
    await expect(DurableRuntime.open({ store, agents: [{ agent, version: "1" }] })).rejects.toThrow(
      "checkpoint support",
    );
    store.acquire();
    store.close();
  });
});
