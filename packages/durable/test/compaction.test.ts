import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { Usage, type CompletionRequest } from "@anvia/core/completion";
import {
  createSummaryMemoryCompactor,
  estimateMemoryTokens,
  isMemoryCompactionMessage,
  type MemoryCompactor,
} from "@anvia/core/memory";
import {
  DurableRuntime,
  type DurableCompactionOptions,
  type DurableAgentRegistration,
  type DurableTransaction,
} from "../src/index.js";
import { parseDurableSnapshot, parseDurableEvent } from "../src/protocol.js";
import { backupSqlite, restoreSqlite } from "../src/maintenance.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import {
  done,
  hasToolResult,
  lookup,
  makeAgent,
  makeStreamingAgent,
  toolResponse,
} from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "anvia-compaction-"));
  directories.push(path);
  return path;
}
const summaryUsage = { ...Usage.empty(), inputTokens: 5, outputTokens: 2, totalTokens: 7 };
const summarize = () =>
  vi.fn<MemoryCompactor>(async () => ({ summary: "Earlier decisions.", usage: summaryUsage }));
function policy(compactor = summarize()): DurableCompactionOptions {
  return { trigger: { afterTokens: 1 }, retention: { recentTurns: 1 }, compactor };
}
async function open(registration: DurableAgentRegistration, path = ":memory:") {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [registration],
  });
  runtimes.push(runtime);
  return runtime;
}
function submit(runtime: DurableRuntime, requestId: string, sessionId = "session") {
  return runtime.submit({
    agentId: "researcher",
    sessionId,
    requestId,
    prompt: `Question ${requestId}`,
  });
}
async function turn(runtime: DurableRuntime, requestId: string, sessionId = "session") {
  const run = await submit(runtime, requestId, sessionId);
  await run.result();
  return run;
}

it("advances summary checkpoints while preserving canonical history, usage and event replay", async () => {
  const compactor = summarize();
  const requests: CompletionRequest[] = [];
  const runtime = await open({
    agent: makeAgent(async (request) => {
      requests.push(request);
      return done();
    }),
    version: "1",
    compaction: policy(compactor),
  });
  await turn(runtime, "1");
  await turn(runtime, "2");
  expect(compactor).not.toHaveBeenCalled();
  const third = await turn(runtime, "3");
  expect(compactor.mock.calls[0]![0].messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(compactor.mock.calls[0]![0].scope).toEqual({ sessionId: "session" });
  const snapshot = parseDurableSnapshot(await third.snapshot());
  expect(snapshot.run.history).toHaveLength(4);
  expect(snapshot.run.history.some(isMemoryCompactionMessage)).toBe(false);
  expect(snapshot.run.contextCheckpoint?.compactedMessageCount).toBe(2);
  expect(snapshot.run.usage.totalTokens).toBe(10);
  expect(snapshot.run.modelTurns).toBe(1);
  expect(requests[2]!.chatHistory.some(isMemoryCompactionMessage)).toBe(true);
  expect(JSON.stringify(requests[2]!.chatHistory)).not.toContain("Question 1");
  expect(JSON.stringify(requests[2]!.chatHistory)).toContain("Question 2");
  expect(snapshot.run.outcome?.messages.some(isMemoryCompactionMessage)).toBe(false);
  const events = runtime.events(third.id, 0).map(parseDurableEvent);
  expect(events.filter((event) => event.type === "compaction_completed")).toHaveLength(1);
  expect(events.find((event) => event.type === "compaction_completed")?.data).toMatchObject({
    compactedMessageCount: 2,
    retainedMessageCount: 2,
    compactedTokenCount: estimateMemoryTokens(compactor.mock.calls[0]![0].messages),
    usage: summaryUsage,
  });
  expect(events.findIndex((event) => event.type === "compaction_completed")).toBeLessThan(
    events.findIndex((event) => event.type === "model_started"),
  );
  const fourth = await turn(runtime, "4");
  expect(compactor.mock.calls[1]![0].messages[0]).toMatchObject({
    role: "system",
    content: "Earlier decisions.",
  });
  expect((await fourth.snapshot()).run.contextCheckpoint?.compactedMessageCount).toBe(4);
  expect((await fourth.snapshot()).run.history).toHaveLength(6);
  await turn(runtime, "other", "another-session");
  expect(compactor).toHaveBeenCalledTimes(2);
});

it("includes the incoming prompt in the trigger and keeps whole user/tool turns", async () => {
  const compactor = summarize();
  const runtime = await open({
    agent: makeAgent(
      async (request) => (hasToolResult(request) ? done() : toolResponse()),
      [lookup(async () => "result")],
    ),
    version: "1",
    toolRecovery: { lookup: "safe" },
    compaction: {
      ...policy(compactor),
      retention: { recentTurns: 0 },
      trigger: { afterTokens: 100 },
      tokenCounter: (messages) =>
        messages.some((message) => message.content === "Question long") ? 101 : 10,
    },
  });
  await turn(runtime, "1");
  await turn(runtime, "long");
  expect(compactor.mock.calls[0]![0].messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
  expect(JSON.stringify(compactor.mock.calls[0]![0].messages)).not.toContain("Question long");
});

it("keeps the prepared projection through approval continuations", async () => {
  const compactor = summarize();
  const approval = { ...lookup(async () => "approved"), requiresApproval: true };
  const runtime = await open({
    agent: makeAgent(
      async (request) => {
        if (
          request.chatHistory.some(
            (message) => message.role === "user" && message.content === "Question approval",
          ) &&
          !hasToolResult(request)
        )
          return toolResponse();
        return done();
      },
      [approval],
    ),
    version: "1",
    toolRecovery: { lookup: "safe" },
    compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
  });
  await turn(runtime, "1");
  const run = await submit(runtime, "approval");
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
  const outcome = (await run.snapshot()).run.outcome;
  if (outcome?.type !== "interaction") throw new Error("Expected approval");
  await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
  await run.result();
  expect(compactor).toHaveBeenCalledTimes(1);
  const next = await turn(runtime, "next");
  expect((await next.snapshot()).run.history.some(isMemoryCompactionMessage)).toBe(false);
  expect(
    (await next.snapshot()).run.history.filter((message) => message.role === "user"),
  ).toHaveLength(2);
});

it("does not enable compaction retroactively for an already submitted run", async () => {
  const path = join(directory(), "runs.sqlite");
  const runtime = await open({ agent: makeAgent(async () => done()), version: "1" }, path);
  await turn(runtime, "1");
  // Persist a queued record without allowing its scheduled attempt to finish.
  const pending = await submit(runtime, "2");
  await runtime.close();
  const compactor = summarize();
  const reopened = await open(
    {
      agent: makeAgent(async () => done()),
      version: "1",
      compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
    },
    path,
  );
  await reopened.resume();
  await (await reopened.getRun(pending.id)).result();
  expect(compactor).not.toHaveBeenCalled();
});

it.each(["empty", "throw", "usage"])(
  "fails safely on %s summaries and supports bounded explicit retry",
  async (failure) => {
    let fail = true;
    const compactor = vi.fn<MemoryCompactor>(async () => {
      if (!fail) return { summary: "Recovered" };
      if (failure === "throw") throw new Error("Summary provider failed");
      return {
        summary: failure === "empty" ? "  " : "Summary",
        usage: failure === "usage" ? { ...summaryUsage, totalTokens: -1 } : summaryUsage,
      };
    });
    const model = vi.fn(async () => done());
    const runtime = await open({
      agent: makeAgent(model),
      version: "1",
      compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
      modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    });
    await turn(runtime, "1");
    const failed = await submit(runtime, "2");
    await expect(failed.result()).rejects.toThrow();
    expect(compactor).toHaveBeenCalledTimes(2);
    expect(model).toHaveBeenCalledTimes(1);
    expect((await failed.snapshot()).run.history).toHaveLength(2);
    expect((await failed.snapshot()).run.contextCheckpoint).toBeUndefined();
    expect(runtime.health().ready).toBe(true);
    fail = false;
    await vi.waitFor(async () => {
      await failed.retry();
    });
    await failed.result();
    expect(compactor).toHaveBeenCalledTimes(3);
  },
);

it.each([-1, NaN, Infinity, 1.5])(
  "rejects invalid token count %s without poisoning storage",
  async (tokens) => {
    const compactor = summarize();
    const runtime = await open({
      agent: makeAgent(async () => done()),
      version: "1",
      compaction: { ...policy(compactor), tokenCounter: () => tokens },
    });
    await expect((await submit(runtime, "1")).result()).rejects.toThrow("token counter");
    expect(compactor).not.toHaveBeenCalled();
    expect(runtime.health().ready).toBe(true);
  },
);

it("validates policy and callbacks when registering", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  for (const compaction of [
    { ...policy(), trigger: { afterTokens: 0 } },
    { ...policy(), retention: { recentTurns: -1 } },
    { ...policy(), compactor: null },
    { ...policy(), tokenCounter: 1 },
  ])
    expect(() =>
      runtime.registerAgents([
        {
          agent: makeAgent(async () => done()),
          version: "1",
          compaction: compaction as DurableCompactionOptions,
        },
      ]),
    ).toThrow();
});

it("compacts streaming registrations before persisting model deltas", async () => {
  const compactor = summarize();
  const agent = makeStreamingAgent(async function* () {
    yield { type: "text_delta", delta: "done" };
    yield { type: "final", response: done() };
  });
  const runtime = await open({
    agent,
    version: "1",
    stream: true,
    compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
  });
  await turn(runtime, "1");
  const run = await turn(runtime, "2");
  expect(compactor).toHaveBeenCalledTimes(1);
  expect(runtime.events(run.id, 0).some((event) => event.type === "compaction_completed")).toBe(
    true,
  );
});

it.each(["summary", "model"])(
  "recovers after SIGKILL during %s without losing canonical history",
  async (stage) => {
    const dir = directory();
    const path = join(dir, "runs.sqlite");
    const calls = join(dir, "summary-calls.txt");
    const child = fork(
      fileURLToPath(new URL("./fixtures/compaction-worker.ts", import.meta.url)),
      [path, calls, stage],
      {
        execArgv: ["--import", import.meta.resolve("tsx")],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let stderr = "";
    child.stderr!.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const { id } = await new Promise<{ id: string }>((resolve, reject) => {
      child.once("message", (message) => resolve(message as { id: string }));
      child.once("exit", () => reject(new Error(stderr)));
      child.once("error", reject);
    });
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    const compactor = summarize();
    const model = vi.fn(async () => done());
    const runtime = await open(
      {
        agent: makeAgent(model),
        version: "1",
        compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
      },
      path,
    );
    await runtime.resume();
    const run = await runtime.getRun(id);
    await run.result();
    expect(compactor).toHaveBeenCalledTimes(stage === "summary" ? 1 : 0);
    expect(readFileSync(calls, "utf8")).toBe("summary\n");
    const snapshot = await run.snapshot();
    expect(snapshot.run.history).toHaveLength(2);
    expect(snapshot.run.history.some(isMemoryCompactionMessage)).toBe(false);
    expect(snapshot.run.usage.totalTokens).toBe(10);
    expect(snapshot.operations.find((operation) => operation.kind === "compaction")?.attempts).toBe(
      stage === "summary" ? 2 : 1,
    );
    expect(
      runtime.events(id, 0).filter((event) => event.type === "compaction_completed"),
    ).toHaveLength(1);
  },
  15000,
);

it("preserves dependency-enriched graph inputs for registrations with compaction", async () => {
  const compactor = summarize();
  const requests: CompletionRequest[] = [];
  const runtime = await open({
    agent: makeAgent(async (request) => {
      requests.push(request);
      return done();
    }),
    version: "1",
    compaction: policy(compactor),
  });
  const graph = await runtime.submitGraph({
    sessionId: "graph",
    requestId: "graph",
    tasks: [
      { id: "source", agentId: "researcher", prompt: "Source" },
      { id: "join", agentId: "researcher", prompt: "Join", dependsOn: ["source"] },
    ],
  });
  await vi.waitFor(async () => expect((await graph.snapshot()).status).toBe("completed"));
  expect(JSON.stringify(requests[1]!.chatHistory)).toContain("done");
  expect(compactor).not.toHaveBeenCalled();
});

it("captures policy at submission even if the restored registration's threshold changes", async () => {
  const path = join(directory(), "runs.sqlite");
  const compactor = summarize();
  const runtime = await open(
    {
      agent: makeAgent(async () => done()),
      version: "1",
      compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
    },
    path,
  );
  await turn(runtime, "1");
  const second = await submit(runtime, "2");
  await runtime.close();
  const reopened = await open(
    {
      agent: makeAgent(async () => done()),
      version: "1",
      compaction: { ...policy(compactor), trigger: { afterTokens: 1_000_000 } },
    },
    path,
  );
  await reopened.resume();
  const run = await reopened.getRun(second.id);
  await run.result();
  expect(compactor).toHaveBeenCalledTimes(1);
  expect((await run.snapshot()).run.compaction).toEqual({
    trigger: { afterTokens: 1 },
    retention: { recentTurns: 0 },
  });
});

it("aborts summarization on cancellation without committing a partial projection", async () => {
  const compactor = vi.fn<MemoryCompactor>(async ({ abortSignal }) => {
    await new Promise<void>((resolve) =>
      abortSignal!.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { summary: "Must not be committed" };
  });
  const model = vi.fn(async () => done());
  const runtime = await open({
    agent: makeAgent(model),
    version: "1",
    compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
  });
  await turn(runtime, "1");
  const run = await submit(runtime, "2");
  await vi.waitFor(() => expect(compactor).toHaveBeenCalledTimes(1));
  await run.cancel();
  await vi.waitFor(() => expect(runtime.health().activeRuns).toBe(0));
  expect((await run.snapshot()).run).toMatchObject({ status: "cancelled" });
  expect((await run.snapshot()).run.contextCheckpoint).toBeUndefined();
  expect(model).toHaveBeenCalledTimes(1);
  expect(
    runtime.events(run.id, 0).filter((event) => event.type === "compaction_completed"),
  ).toHaveLength(0);
});

it("rolls back the summary, usage, event and prepared input together on a storage failure", async () => {
  const path = join(directory(), "runs.sqlite");
  class FailingStore extends SqliteDurableStore {
    override transaction<T>(callback: (tx: DurableTransaction) => T): T {
      return super.transaction((tx) =>
        callback({
          ...tx,
          putRun(run) {
            if (run.contextCheckpoint !== undefined) throw new Error("Injected write failure");
            tx.putRun(run);
          },
        }),
      );
    }
  }
  const compactor = summarize();
  const registration = {
    agent: makeAgent(async () => done()),
    version: "1",
    compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
  };
  const runtime = await DurableRuntime.open({
    store: new FailingStore(path),
    agents: [registration],
  });
  runtimes.push(runtime);
  await turn(runtime, "1");
  const run = await submit(runtime, "2");
  await vi.waitFor(() => expect(runtime.health().status).toBe("failed"));
  await runtime.close();
  const reopened = await open(registration, path);
  const recovered = await reopened.getRun(run.id);
  const before = await recovered.snapshot();
  expect(before.run.contextCheckpoint).toBeUndefined();
  expect(before.run.contextPrepared).toBeUndefined();
  expect(before.run.usage.totalTokens).toBe(0);
  expect(before.operations.find((operation) => operation.kind === "compaction")?.status).toBe(
    "started",
  );
  expect(reopened.events(run.id, 0).some((event) => event.type === "compaction_completed")).toBe(
    false,
  );
  await reopened.resume();
  await recovered.result();
  expect(compactor).toHaveBeenCalledTimes(2);
  expect((await recovered.snapshot()).run.usage.totalTokens).toBe(10);
});

it("preserves compaction checkpoints and complete history through backup and restore", async () => {
  const dir = directory();
  const path = join(dir, "live.sqlite");
  const compactor = summarize();
  const registration = {
    agent: makeAgent(async () => done()),
    version: "1",
    compaction: { ...policy(compactor), retention: { recentTurns: 0 } },
  };
  const runtime = await open(registration, path);
  await turn(runtime, "1");
  const run = await turn(runtime, "2");
  const before = await run.snapshot();
  await runtime.close();
  const archive = join(dir, "backup.sqlite");
  const restored = join(dir, "restored.sqlite");
  expect((await backupSqlite(path, archive)).schemaVersion).toBe(6);
  expect((await restoreSqlite(archive, restored)).schemaVersion).toBe(6);
  const reopened = await open(registration, restored);
  expect(await (await reopened.getRun(run.id)).snapshot()).toEqual(before);
  const next = await turn(reopened, "3");
  expect((await next.snapshot()).run.history).toHaveLength(4);
  expect((await next.snapshot()).run.contextCheckpoint?.compactedMessageCount).toBe(4);
});

it("accepts the built-in core summary compactor without agent memory", async () => {
  const summaryModel = vi.fn(async () => done());
  const runtime = await open({
    agent: makeAgent(async () => done()),
    version: "1",
    compaction: {
      trigger: { afterTokens: 1 },
      retention: { recentTurns: 0 },
      compactor: createSummaryMemoryCompactor({
        model: makeAgent(summaryModel).model,
        retries: false,
      }),
    },
  });
  await turn(runtime, "1");
  const run = await turn(runtime, "2");
  expect(summaryModel).toHaveBeenCalledTimes(1);
  expect((await run.snapshot()).run.contextCheckpoint?.summary).toBe("done");
  expect((await run.snapshot()).run.usage.totalTokens).toBe(6);
});
