import { expectJournalRequests } from "./journal-assertions.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime, type DurableRuntimeOptions } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const input = { agentId: "researcher", sessionId: "session", requestId: "one", prompt: "first" };
async function open(options: Omit<DurableRuntimeOptions, "store">, path = ":memory:") {
  const runtime = await DurableRuntime.open({ ...options, store: new SqliteDurableStore(path) });
  runtimes.push(runtime);
  return runtime;
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("run discovery and scheduling", () => {
  it("paginates summaries in insertion order with independent filters and detached values", async () => {
    const runtime = await open({
      agents: [{ agent: makeAgent(async () => done()), version: "1" }],
    });
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const run = await runtime.submit({ ...input, sessionId: `session-${index}` });
      ids.push(run.id);
      await run.result();
    }
    const first = await runtime.listRuns({ limit: 2 });
    expect(first.runs.map((run) => run.id)).toEqual(ids.slice(0, 2));
    expect(first.runs[0]).not.toHaveProperty("prompt");
    expect(first.runs[0]).not.toHaveProperty("history");
    first.runs[0]!.status = "failed";
    const second = await runtime.listRuns({ limit: 2, after: first.nextCursor });
    expect(second.runs.map((run) => run.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeUndefined();
    expect(
      (
        await runtime.listRuns({
          sessionId: "session-0",
          status: "completed",
          agentId: "researcher",
        })
      ).runs,
    ).toHaveLength(1);
    expect((await runtime.listRuns({ sessionId: "' OR 1=1 --" })).runs).toEqual([]);
    await expect(runtime.listRuns({ limit: 101 })).rejects.toThrow();
    await expect(runtime.listRuns({ after: -1 })).rejects.toThrow();
  });

  it("bounds concurrency and captures queued session history only after its predecessor completes", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = vi.fn(async () => {
      await held;
      return done();
    });
    const runtime = await open({
      agents: [{ agent: makeAgent(model), version: "1" }],
      maxConcurrentRuns: 1,
    });
    const first = await runtime.submit(input);
    const second = await runtime.submit(
      { ...input, requestId: "two", prompt: "second" },
      { enqueue: true },
    );
    const third = await runtime.submit({ ...input, sessionId: "other" });
    try {
      await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
      expect((await second.snapshot()).run.status).toBe("queued");
      expect((await third.snapshot()).run.status).toBe("queued");
      expect((await runtime.listRuns({ status: "queued" })).runs).toHaveLength(2);
      const duplicate = await runtime.submit({ ...input, requestId: "two", prompt: "second" });
      expect(duplicate.id).toBe(second.id);
      release();
      await Promise.all([first.result(), second.result(), third.result()]);
      const history = (await second.snapshot()).run.history;
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ role: "user", content: "first" });
    } finally {
      release();
    }
  });

  it("lets other sessions proceed while approval blocks its own queue", async () => {
    const agent = makeAgent(
      async (request) => (hasToolResult(request) ? done() : toolResponse()),
      [{ ...lookup(async () => "ok"), requiresApproval: true }],
    );
    const runtime = await open({ agents: [{ agent, version: "1" }], maxConcurrentRuns: 1 });
    const first = await runtime.submit(input);
    const queued = await runtime.submit({ ...input, requestId: "two" }, { enqueue: true });
    const other = await runtime.submit({ ...input, sessionId: "other" });
    await vi.waitFor(async () => expect((await other.snapshot()).run.status).toBe("waiting"));
    expect((await first.snapshot()).run.status).toBe("waiting");
    expect((await queued.snapshot()).run.status).toBe("queued");
    await queued.cancel();
    expect((await queued.snapshot()).run.status).toBe("cancelled");
    const outcome = (await first.snapshot()).run.outcome;
    if (outcome?.type !== "interaction") throw new Error("Missing interaction");
    await first.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
    await first.result();
    expect((await queued.snapshot()).operations).toEqual([]);
  });

  it("restores queued work and its order after shutdown", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-queue-"));
    directories.push(directory);
    const path = join(directory, "runs.sqlite");
    const firstModel = vi.fn(
      async (_request, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    );
    const first = await open(
      { agents: [{ agent: makeAgent(firstModel), version: "1" }], maxConcurrentRuns: 1 },
      path,
    );
    const head = await first.submit(input);
    const queued = await first.submit({ ...input, requestId: "two" }, { enqueue: true });
    await vi.waitFor(() => expect(firstModel).toHaveBeenCalledTimes(1));
    await first.close();
    const model = vi.fn(async () => done());
    const restarted = await open(
      { agents: [{ agent: makeAgent(model), version: "1" }], maxConcurrentRuns: 1 },
      path,
    );
    await restarted.resume();
    await (await restarted.getRun(head.id)).result();
    const restored = await restarted.getRun(queued.id);
    await restored.result();
    expect((await restored.snapshot()).run.history).toHaveLength(2);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("persists backoff and the original retry policy across reopening", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-backoff-"));
    directories.push(directory);
    const path = join(directory, "runs.sqlite");
    const model = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(done());
    const first = await open(
      {
        agents: [
          {
            agent: makeAgent(model),
            version: "1",
            modelRetry: { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 500 },
          },
        ],
      },
      path,
    );
    const run = await first.submit(input);
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("retry_wait"));
    const before = await run.snapshot();
    await first.close();
    const restarted = await open({ agents: [{ agent: makeAgent(model), version: "1" }] }, path);
    await restarted.resume();
    const restored = await restarted.getRun(run.id);
    expect((await restored.snapshot()).run.nextAttemptAt).toBe(before.run.nextAttemptAt);
    expect(model).toHaveBeenCalledTimes(1);
    expect(await restored.result()).toMatchObject({ output: "done" });
    expectJournalRequests(restarted, restored.id);
    const after = await restored.snapshot();
    expect(after.operations[0]?.attempts).toBe(2);
    expect(after.run.modelTurns).toBe(1);
    expect(after.run.usage.totalTokens).toBe(3);
    expect(after.run.nextAttemptAt).toBeUndefined();
  });

  it("caps automatic model attempts", async () => {
    const model = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const runtime = await open({
      agents: [
        {
          agent: makeAgent(model),
          version: "1",
          modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
        },
      ],
    });
    const run = await runtime.submit(input);
    await expect(run.result()).rejects.toMatchObject({ status: "failed", message: "unavailable" });
    expect(model).toHaveBeenCalledTimes(2);
    expect((await run.snapshot()).run.modelTurns).toBe(1);
  });

  it("can retry a failed predecessor after cancelling a successor before it starts", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = vi
      .fn()
      .mockImplementationOnce(async () => {
        await held;
        throw new Error("temporary");
      })
      .mockResolvedValue(done());
    const runtime = await open({ agents: [{ agent: makeAgent(model), version: "1" }] });
    const first = await runtime.submit(input);
    try {
      const queued = await runtime.submit({ ...input, requestId: "two" }, { enqueue: true });
      await queued.cancel();
      expect((await queued.snapshot()).run.startedAt).toBeUndefined();
      release();
      await expect(first.result()).rejects.toMatchObject({ status: "failed" });
      await first.retry();
      expect(await first.result()).toMatchObject({ output: "done" });
      expect(model).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  });

  it("cancels a persisted backoff without invoking the model again", async () => {
    const model = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const runtime = await open({
      agents: [
        {
          agent: makeAgent(model),
          version: "1",
          modelRetry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 1000 },
        },
      ],
    });
    const run = await runtime.submit(input);
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("retry_wait"));
    await run.cancel();
    await runtime.resume();
    expect(model).toHaveBeenCalledTimes(1);
    await expect(run.result()).rejects.toMatchObject({ status: "cancelled" });
    expect((await run.snapshot()).run.nextAttemptAt).toBeUndefined();
  });
});
