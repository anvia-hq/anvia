import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import { InMemoryMemoryStore, type MemoryStore } from "@anvia/core/memory";
import { z } from "zod";
import type { CompletionModelStreamEvent } from "@anvia/core/completion";
import { DurableRuntime, defineTask, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, lookup, toolResponse } from "./helpers.js";

type AnyAgent = DurableAgentRegistration["agent"];

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
const scope = { sessionId: "session" };
const submission = { agentId: "remembering", sessionId: "session", requestId: "one" };

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-memory-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

function agentWith(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  store: MemoryStore,
  savePolicy: "message" | "run" = "run",
): AnyAgent {
  return new Agent({
    id: "remembering",
    memory: { store, savePolicy },
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  } as ConstructorParameters<typeof Agent>[0]);
}

function registration(agent: AnyAgent, marker = true): DurableAgentRegistration {
  return marker ? { agent, version: "1", memory: { mode: "recorded" } } : { agent, version: "1" };
}

async function open(path: string, agent: AnyAgent) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [registration(agent)],
  });
  runtimes.push(runtime);
  return runtime;
}

async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

const userText = (request: CompletionRequest) => JSON.stringify(request.chatHistory);

/** Fails a test that waits for a step the runtime never reaches, instead of hanging. */
function within<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("step not reached")), ms)),
  ]);
}

const storedCount = async (store: MemoryStore) => (await store.load({ scope })).length;

it("rejects memory without the recorded marker and names the field", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = agentWith(async () => done(), new InMemoryMemoryStore());
  expect(() => runtime.registerAgents([registration(agent, false)])).toThrow(
    /memory needs \{ memory: \{ mode: "recorded" \} \}/,
  );
  expect(runtime.compatibility()).toEqual([]);
});

it("rejects a store without loadVersioned and names memory", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const unversioned: MemoryStore = {
    load: async () => [],
    append: async () => {},
    clear: async () => {},
  };
  expect(() =>
    runtime.registerAgents([registration(agentWith(async () => done(), unversioned))]),
  ).toThrow(/memory\.store without loadVersioned\(\)/);
  expect(runtime.compatibility()).toEqual([]);
});

it("rejects memory compaction under the recorded marker and names the field", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = new Agent({
    id: "remembering",
    memory: {
      store: Object.assign(new InMemoryMemoryStore(), {
        compaction: {
          snapshot: async () => ({ revision: "1", messages: [] }),
          replacePrefix: async () => ({ status: "committed" as const }),
        },
      }),
      savePolicy: "run",
      compaction: {
        trigger: { afterTokens: 10 },
        compactor: async () => ({ summary: "s" }),
      },
    },
    model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
  } as ConstructorParameters<typeof Agent>[0]);
  expect(() => runtime.registerAgents([registration(agent)])).toThrow(/memory\.compaction/);
});

it("reads the stored history and writes the reply under a runtime-derived key", async () => {
  const store = new InMemoryMemoryStore();
  await store.append({
    scope,
    runId: "earlier",
    turn: 1,
    messages: [
      { role: "user", content: [{ type: "text", text: "remember blue" }] },
      { role: "assistant", content: [{ type: "text", text: "noted" }] },
    ],
  });
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const appendSpy = vi.spyOn(store, "append");
  const runtime = await open(database(), agentWith(model, store));
  const run = await runtime.submit({ ...submission, prompt: "what colour?" });
  const snapshot = await settled(run);

  expect(snapshot.run.status).toBe("completed");
  expect(userText(model.mock.calls[0]![0])).toContain("remember blue");
  const writes = appendSpy.mock.calls;
  expect(writes).toHaveLength(1);
  expect(writes.map((call) => call[0].idempotencyKey)).toEqual([`${run.id}/0:memory:write:0`]);
  expect(writes[0]![0].expectedVersion).toBe("1");
  expect(await storedCount(store)).toBe(4);
  const memoryOperations = snapshot.operations.filter((operation) => operation.kind === "memory");
  expect(memoryOperations.map((operation) => [operation.key, operation.recovery])).toEqual([
    ["0:memory:read", "safe"],
    ["0:memory:write:0", "manual"],
  ]);
});

it("writes only after the terminal checkpoint, and keeps the run open until then", async () => {
  const store = new InMemoryMemoryStore();
  const runtime = await open(
    database(),
    agentWith(async () => done(), store),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  const seen: Array<{ status: string; hasOutcome: boolean }> = [];
  const real = store.append.bind(store);
  store.append = async (options) => {
    const { run: current } = runtime.snapshot(submitted.id, { operations: false });
    seen.push({ status: current.status, hasOutcome: current.outcome !== undefined });
    return real(options);
  };
  const snapshot = await settled(submitted);
  expect(snapshot.run.status).toBe("completed");
  expect(seen).toEqual([{ status: "running", hasOutcome: true }]);
});

it("reuses the recorded read snapshot on retry, and flags a write made after it as a conflict", async () => {
  const store = new InMemoryMemoryStore();
  await store.append({
    scope,
    runId: "earlier",
    turn: 1,
    messages: [{ role: "user", content: [{ type: "text", text: "remember blue" }] }],
  });
  const loads = vi.spyOn(store, "loadVersioned");
  const model = vi
    .fn(async (_request: CompletionRequest) => done())
    .mockRejectedValueOnce(new Error("provider down"));
  const runtime = await open(database(), agentWith(model, store));
  const submitted = await runtime.submit({ ...submission, prompt: "what colour?" });
  expect((await settled(submitted)).run.status).toBe("failed");
  const firstRequest = userText(model.mock.calls[0]![0]);

  // Another writer commits between the attempts; a replay must not see it.
  await store.append({
    scope,
    runId: "other",
    turn: 1,
    messages: [{ role: "user", content: [{ type: "text", text: "late note" }] }],
  });
  const run = await runtime.getRun(submitted.id);
  await run.retry();
  const snapshot = await settled(run);

  // The late note moved the version on, so the retried write is a conflict, not a silent overwrite.
  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.blockedOperation).toBe("0:memory:write:0");
  expect(loads).toHaveBeenCalledTimes(1);
  expect(userText(model.mock.calls[1]![0])).toBe(firstRequest);
  expect(firstRequest).not.toContain("late note");
});

it("keeps a duplicate write from being stored twice after the store committed it", async () => {
  const store = new InMemoryMemoryStore();
  const real = store.append.bind(store);
  let lost = true;
  store.append = async (options) => {
    const result = await real(options);
    // The store commits, then the response is lost.
    if (lost) {
      lost = false;
      throw new Error("response lost");
    }
    return result;
  };
  const runtime = await open(
    database(),
    agentWith(async () => done(), store),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  expect((await settled(submitted)).run.status).toBe("failed");
  const run = await runtime.getRun(submitted.id);
  await run.retry();
  expect((await settled(run)).run.status).toBe("completed");

  const messages = await store.load({ scope });
  expect(messages).toHaveLength(2);
  expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
});

it("needs attention on a conflict and writes nothing from the run", async () => {
  const store = new InMemoryMemoryStore();
  const runtime = await open(
    database(),
    agentWith(async () => {
      // A concurrent writer commits while the run is in its model call.
      await store.append({
        scope,
        runId: "other",
        turn: 1,
        messages: [{ role: "user", content: [{ type: "text", text: "concurrent" }] }],
      });
      return done();
    }, store),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  const snapshot = await settled(submitted);

  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.blockedOperation).toBe("0:memory:write:0");
  expect(snapshot.run.error).toMatch(/conflicts with the memory store/);
  expect(await storedCount(store)).toBe(1);
});

it("resumes after a crash between the terminal checkpoint and the writes, without running the model again", async () => {
  const path = database();
  const store = new InMemoryMemoryStore();
  const real = store.append.bind(store);
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const first = await open(path, agentWith(model, store, "message"));
  const submitted = await first.submit({ ...submission, prompt: "hello" });

  // The first write is in flight when the process stops, so the store never sees it.
  let inFlight!: () => void;
  const started = new Promise<void>((resolve) => (inFlight = resolve));
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => (stop = resolve));
  store.append = async () => {
    inFlight();
    await stopped;
    throw new Error("process stopped");
  };
  await within(started);
  const closing = first.close();
  stop();
  await closing;
  runtimes.splice(runtimes.indexOf(first), 1);
  expect(await storedCount(store)).toBe(0);

  store.append = real;
  const second = await open(path, agentWith(model, store, "message"));
  const run = await second.getRun(submitted.id);
  expect((await run.snapshot()).run.status).toBe("running");
  // The first write was attempted before the stop, so its outcome is unknown: it needs attention.
  await second.resume();
  const blocked = await settled(run);
  expect(blocked.run.status).toBe("needs_attention");
  expect(blocked.run.blockedOperation).toBe("0:memory:write:0");

  await run.retry();
  expect((await settled(run)).run.status).toBe("completed");
  expect(model).toHaveBeenCalledTimes(1);
  expect(await storedCount(store)).toBe(2);
});

it("fails a run that pauses for a human interaction instead of replaying memory twice", async () => {
  const store = new InMemoryMemoryStore();
  const approval = { ...lookup(async () => "approved"), requiresApproval: true };
  const model = vi.fn(async (request: CompletionRequest) =>
    request.chatHistory.some((message) => message.role === "tool") ? done() : toolResponse(),
  );
  const agent = new Agent({
    id: "remembering",
    tools: [approval],
    memory: { store, savePolicy: "message" },
    model: { provider: "test", modelId: "test", capabilities, completion: model },
  } as ConstructorParameters<typeof Agent>[0]);
  const runtime = await open(database(), agent);
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  const snapshot = await settled(submitted);
  expect(snapshot.run.status).toBe("failed");
  expect(snapshot.run.error).toMatch(/paused for a human interaction/);
});

async function conflicted() {
  const store = new InMemoryMemoryStore();
  const model = vi.fn(async (_request: CompletionRequest) => {
    // A concurrent writer commits while the run is in its model call.
    await store.append({
      scope,
      runId: "other",
      turn: 1,
      messages: [{ role: "user", content: [{ type: "text", text: "concurrent" }] }],
    });
    return done();
  });
  const runtime = await open(database(), agentWith(model, store));
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  expect((await settled(submitted)).run.status).toBe("needs_attention");
  return { store, runtime, run: await runtime.getRun(submitted.id), model };
}

it("completes a conflicted run when the operator discards the write", async () => {
  const { store, run, model } = await conflicted();

  await run.resolveMemoryWrite("0:memory:write:0", "discarded");
  const snapshot = await settled(run);

  expect(snapshot.run.status).toBe("completed");
  expect(snapshot.run.blockedOperation).toBeUndefined();
  expect(snapshot.run.error).toBeUndefined();
  expect(model).toHaveBeenCalledTimes(1);
  expect(await storedCount(store)).toBe(1);
  const write = snapshot.operations.find((operation) => operation.key === "0:memory:write:0");
  expect(write?.result).toEqual({ status: "discarded", version: null });
});

it("completes a conflicted run when the operator marks the write applied, without sending it", async () => {
  const { store, run } = await conflicted();
  const appendSpy = vi.spyOn(store, "append");

  await run.resolveMemoryWrite("0:memory:write:0", "applied");

  expect((await settled(run)).run.status).toBe("completed");
  expect(appendSpy).not.toHaveBeenCalled();
});

it("sends the remaining writes without a version check after a resolution", async () => {
  const store = new InMemoryMemoryStore();
  const runtime = await open(
    database(),
    agentWith(
      async () => {
        await store.append({
          scope,
          runId: "other",
          turn: 1,
          messages: [{ role: "user", content: [{ type: "text", text: "concurrent" }] }],
        });
        return done();
      },
      store,
      "message",
    ),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  expect((await settled(submitted)).run.status).toBe("needs_attention");
  const appendSpy = vi.spyOn(store, "append");

  const run = await runtime.getRun(submitted.id);
  await run.resolveMemoryWrite("0:memory:write:0", "discarded");
  expect((await settled(run)).run.status).toBe("completed");

  expect(appendSpy.mock.calls.map((call) => call[0].expectedVersion)).toEqual([undefined]);
  expect(await storedCount(store)).toBe(2);
});

it("rejects a resolution that does not match the blocked memory write", async () => {
  const { run } = await conflicted();

  await expect(run.resolveMemoryWrite("0:memory:write:9", "discarded")).rejects.toThrow(
    /No matching memory write/,
  );
  await expect(run.resolveMemoryWrite("0:memory:read", "discarded")).rejects.toThrow(
    /No matching memory write/,
  );
  await expect(run.resolveMemoryWrite("0:memory:write:0", "retry" as never)).rejects.toThrow(
    /resolution must be/,
  );
  expect((await run.snapshot()).run.status).toBe("needs_attention");
});

it("rejects a resolution for a run that is not blocked", async () => {
  const runtime = await open(
    database(),
    agentWith(async () => done(), new InMemoryMemoryStore()),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  expect((await settled(submitted)).run.status).toBe("completed");

  await expect(submitted.resolveMemoryWrite("0:memory:write:0", "discarded")).rejects.toThrow(
    /No matching memory write/,
  );
});

it("records memory for a streaming run and writes the reply once", async () => {
  const store = new InMemoryMemoryStore();
  const appendSpy = vi.spyOn(store, "append");
  const agent = new Agent({
    id: "remembering",
    memory: { store, savePolicy: "run" },
    model: {
      provider: "test",
      modelId: "test",
      capabilities: { ...capabilities, streaming: true },
      completion: async () => done(),
      async *streamCompletion(): AsyncIterable<CompletionModelStreamEvent> {
        yield { type: "text_delta", delta: "do" };
        yield { type: "text_delta", delta: "ne" };
        yield { type: "final", response: done() };
      },
    },
  } as ConstructorParameters<typeof Agent>[0]);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(database()),
    agents: [{ ...registration(agent), stream: true }],
  });
  runtimes.push(runtime);

  const submitted = await runtime.submit({ ...submission, prompt: "hello" });
  const snapshot = await settled(submitted);

  expect(snapshot.run.status).toBe("completed");
  expect(appendSpy).toHaveBeenCalledTimes(1);
  expect((await store.load({ scope })).map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
});

it("leaves memory unwritten and does not call recordError when the run fails", async () => {
  const store = new InMemoryMemoryStore();
  const recordError = vi.fn(async () => {});
  Object.assign(store, { recordError });
  const appendSpy = vi.spyOn(store, "append");
  const runtime = await open(
    database(),
    agentWith(async () => {
      throw new Error("provider down");
    }, store),
  );
  const submitted = await runtime.submit({ ...submission, prompt: "hello" });

  expect((await settled(submitted)).run.status).toBe("failed");
  expect(appendSpy).not.toHaveBeenCalled();
  expect(recordError).not.toHaveBeenCalled();
  expect(await storedCount(store)).toBe(0);
});

it("rejects a graph that uses a recorded memory agent and creates nothing", async () => {
  const runtime = await open(
    database(),
    agentWith(async () => done(), new InMemoryMemoryStore()),
  );

  await expect(
    runtime.submitGraph({
      sessionId: "project",
      requestId: "graph",
      tasks: [{ id: "one", agentId: "remembering", prompt: "hi" }],
    }),
  ).rejects.toThrow(/records memory, which graph tasks do not support/);
  expect((await runtime.listGraphs()).graphs).toHaveLength(0);
  expect((await runtime.listRuns()).runs).toHaveLength(0);
});

it("fails an owned agent task that spawns a recorded memory agent, naming the limit", async () => {
  const store = new InMemoryMemoryStore();
  const parent = defineTask({
    name: "parent",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.null(),
    initial: () => null,
    run: async (ctx) => {
      ctx.spawnAgent("child", { agentId: "remembering", prompt: "hi" });
      return { status: "completed", output: null };
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(database()),
    tasks: [parent],
    agents: [registration(agentWith(async () => done(), store))],
  });
  runtimes.push(runtime);

  const task = await runtime.submitTask(parent, { sessionId: "s", requestId: "1", input: null });

  await expect(task.result()).rejects.toThrow(/owned agent tasks do not support/);
  expect(await storedCount(store)).toBe(0);
});
