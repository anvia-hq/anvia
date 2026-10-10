import { expectJournalRequests } from "./journal-assertions.js";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
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
  type DurableAgentRegistration,
  type DurableTransaction,
} from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { backupSqlite, restoreSqlite } from "../src/maintenance.js";
import { parseDurableSnapshot } from "../src/protocol.js";
import {
  capabilities,
  done,
  lookup,
  makeAgent,
  makeStreamingAgent,
  toolResponse,
} from "./helpers.js";

const large = "payload".repeat(1000);
const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "1",
  prompt: "Find the answer",
};
const usage = { ...Usage.empty(), inputTokens: 5, outputTokens: 2, totalTokens: 7 };
const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "anvia-loop-"));
  directories.push(dir);
  return dir;
}
const summarize = () => vi.fn(async () => ({ summary: "Lookup found the answer.", usage }));
const policy = (compactor: MemoryCompactor = summarize()) => ({
  trigger: { afterTokens: 500 },
  retention: { recentToolTurns: 0 },
  compactor,
});
async function open(registration: DurableAgentRegistration, path = ":memory:") {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [registration],
  });
  runtimes.push(runtime);
  return runtime;
}

it("compacts newly approved tool output while keeping the continuation and transcript intact", async () => {
  let calls = 0;
  const requests: CompletionRequest[] = [];
  const compactor = summarize();
  const tool = vi.fn(async () => large);
  const runtime = await open({
    agent: makeAgent(
      async (request) => {
        requests.push(request);
        if (++calls === 1) return toolResponse();
        if (JSON.stringify(request.chatHistory).length > 2000)
          throw new Error("context length exceeded");
        return done();
      },
      [{ ...lookup(tool), requiresApproval: true }],
    ),
    version: "1",
    compaction: policy(compactor),
  });
  const run = await runtime.submit(submission);
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
  const outcome = (await run.snapshot()).run.outcome;
  if (outcome?.type !== "interaction") throw new Error("Expected approval");
  await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
  await run.result();
  expectJournalRequests(runtime, run.id);
  expect(compactor).toHaveBeenCalledTimes(1);
  expect(tool).toHaveBeenCalledTimes(1);
  expect(requests[1]!.chatHistory.some(isMemoryCompactionMessage)).toBe(true);
  const next = await runtime.submit({ ...submission, requestId: "2", prompt: "Continue" });
  await next.result();
  expect((await next.snapshot()).run.history.some(isMemoryCompactionMessage)).toBe(false);
  expect(JSON.stringify((await next.snapshot()).run.history)).toContain(large);
});

it("cancels an in-flight summary without committing its projection or usage", async () => {
  const summaryCompletion = vi.fn(
    async (request: CompletionRequest, options?: { abortSignal?: AbortSignal | undefined }) => {
      expect(Object.hasOwn(request, "temperature")).toBe(false);
      await new Promise<void>((resolve) =>
        options!.abortSignal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { ...done(), usage };
    },
  );
  const compactor = vi.fn(
    createSummaryMemoryCompactor({
      model: {
        provider: "test",
        modelId: "no-temperature",
        capabilities,
        completion: summaryCompletion,
      },
      temperature: null,
    }),
  );
  const model = vi.fn(async () => toolResponse());
  const runtime = await open({
    agent: makeAgent(model, [lookup(async () => large)]),
    version: "1",
    compaction: policy(compactor),
  });
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(summaryCompletion).toHaveBeenCalledTimes(1));
  await run.cancel();
  await vi.waitFor(() => expect(runtime.health().activeRuns).toBe(0));
  expect((await run.snapshot()).run.usage.totalTokens).toBe(3);
  expect(runtime.events(run.id, 0).some((event) => event.type === "compaction_completed")).toBe(
    false,
  );
  expect(model).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "compacts within a bounded model loop (stream=%s) and retains canonical messages",
  async (stream) => {
    const requests: CompletionRequest[] = [];
    const completion = async (request: CompletionRequest) => {
      requests.push(request);
      if (JSON.stringify(request.chatHistory).length > 2000)
        throw new Error("context length exceeded");
      return requests.length <= 2 ? toolResponse() : done();
    };
    const tool = vi.fn(async () => large);
    const agent = stream
      ? makeStreamingAgent(
          async function* (request) {
            yield { type: "final", response: await completion(request) };
          },
          [lookup(tool)],
        )
      : makeAgent(completion, [lookup(tool)]);
    const summaryCompletion = vi.fn(async (request: CompletionRequest) => {
      if (Object.hasOwn(request, "temperature")) throw new Error("Unsupported temperature");
      return { ...done(), usage };
    });
    const compactor = vi.fn(
      createSummaryMemoryCompactor({
        model: {
          provider: "test",
          modelId: "no-temperature",
          capabilities,
          completion: summaryCompletion,
        },
        temperature: null,
      }),
    );
    const runtime = await open({
      agent,
      version: "1",
      stream,
      compaction: policy(compactor),
      toolRecovery: { lookup: "safe" },
    });
    const run = await runtime.submit(submission);
    await run.result();
    expectJournalRequests(runtime, run.id);
    const snapshot = parseDurableSnapshot(await run.snapshot());
    expect(snapshot.run.usage.totalTokens).toBe(23);
    expect(
      snapshot.run.outcome?.messages.filter((message) => message.role === "tool"),
    ).toHaveLength(2);
    expect(snapshot.run.outcome?.messages.some(isMemoryCompactionMessage)).toBe(false);
    expect(compactor).toHaveBeenCalledTimes(2);
    expect(summaryCompletion).toHaveBeenCalledTimes(2);
    expect(tool).toHaveBeenCalledTimes(2);
    expect(requests[1]!.chatHistory.map((message) => message.role)).toEqual(["system", "user"]);
    expect(
      runtime.events(run.id, 0).filter((event) => event.type === "compaction_completed"),
    ).toHaveLength(2);
    // A single previous user-led turn can itself be too large for the next submission.
    await (await runtime.submit({ ...submission, requestId: "2", prompt: "Continue" })).result();
    expect(
      requests
        .at(-1)!
        .chatHistory.some((message) => message.role === "user" && message.content === "Continue"),
    ).toBe(true);
  },
);

it.each(["summary", "prepared", "model"])(
  "recovers after SIGKILL during %s without changing a committed projection or usage",
  async (stage) => {
    const dir = directory();
    const path = join(dir, "runs.sqlite");
    const calls = join(dir, "calls");
    const child = fork(
      fileURLToPath(new URL("./fixtures/loop-compaction-worker.ts", import.meta.url)),
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
    // An uncommitted retry may return a different summary and usage. Once committed,
    // neither callback may run again, even if it would return a different result.
    const retryUsage = { ...Usage.empty(), inputTokens: 8, outputTokens: 3, totalTokens: 11 };
    const compactor = vi.fn(async () => ({
      summary: "Summary from the retry.",
      usage: retryUsage,
    }));
    const tokenCounter = vi.fn((messages: Parameters<typeof estimateMemoryTokens>[0]) => {
      if (stage === "model") throw new Error("Committed preparation must not call the counter");
      return estimateMemoryTokens(messages);
    });
    const tool = vi.fn(async () => large);
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(
      {
        agent: makeAgent(model, [lookup(tool)]),
        version: "1",
        compaction: { ...policy(compactor), tokenCounter },
        toolRecovery: { lookup: "safe" },
      },
      path,
    );
    const run = await runtime.getRun(id);
    const before = await run.snapshot();
    const savedContext = before.operations.find((operation) => operation.key === "0:context:2");
    expect(savedContext?.status).toBe(stage === "model" ? "completed" : "started");
    expect(before.run.usage.totalTokens).toBe(stage === "model" ? 10 : 3);
    await runtime.resume();
    await run.result();
    expectJournalRequests(runtime, run.id);
    expect(readFileSync(calls, "utf8")).toBe("tool\nsummary\n");
    expect(tool).not.toHaveBeenCalled();
    expect(compactor).toHaveBeenCalledTimes(stage === "model" ? 0 : 1);
    if (stage === "model") expect(tokenCounter).not.toHaveBeenCalled();
    expect(model).toHaveBeenCalledTimes(1);
    const after = await run.snapshot();
    expect(after.run.usage.totalTokens).toBe(stage === "model" ? 13 : 17);
    const completedContext = after.operations.find((operation) => operation.key === "0:context:2");
    if (stage === "model") expect(completedContext).toEqual(savedContext);
    expect(model.mock.calls[0]![0].chatHistory).toContainEqual(
      expect.objectContaining({
        role: "system",
        content: stage === "model" ? "Lookup found the answer." : "Summary from the retry.",
      }),
    );
    expect(
      runtime.events(id, 0).filter((event) => event.type === "compaction_completed"),
    ).toHaveLength(1);
  },
  15000,
);

it("bounds invalid in-loop summaries and resets their attempts on explicit retry", async () => {
  let valid = false;
  const compactor = vi.fn(async () => ({ summary: valid ? "Recovered" : " " }));
  const tool = vi.fn(async () => large);
  let calls = 0;
  const runtime = await open({
    agent: makeAgent(async () => (++calls === 1 ? toolResponse() : done()), [lookup(tool)]),
    version: "1",
    compaction: policy(compactor),
    modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
  });
  const run = await runtime.submit(submission);
  await expect(run.result()).rejects.toThrow();
  expect(compactor).toHaveBeenCalledTimes(2);
  expect(calls).toBe(1);
  expect(tool).toHaveBeenCalledTimes(1);
  valid = true;
  await vi.waitFor(async () => {
    await run.retry();
  });
  await run.result();
  expectJournalRequests(runtime, run.id);
  expect(compactor).toHaveBeenCalledTimes(3);
  expect(tool).toHaveBeenCalledTimes(1);
});

it("rolls back projected context, usage, and progress together on a journal failure", async () => {
  class FailingStore extends SqliteDurableStore {
    override transaction<T>(callback: (tx: DurableTransaction) => T): T {
      return super.transaction((tx) =>
        callback({
          ...tx,
          appendEvent(id, type, data) {
            if (type === "compaction_completed") throw new Error("Injected journal failure");
            tx.appendEvent(id, type, data);
          },
        }),
      );
    }
  }
  const path = join(directory(), "runs.sqlite");
  const compactor = summarize();
  const tool = vi.fn(async () => large);
  let calls = 0;
  const registration = {
    agent: makeAgent(async () => (++calls === 1 ? toolResponse() : done()), [lookup(tool)]),
    version: "1",
    compaction: policy(compactor),
  };
  const runtime = await DurableRuntime.open({
    store: new FailingStore(path),
    agents: [registration],
  });
  runtimes.push(runtime);
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(runtime.health().status).toBe("failed"));
  await runtime.close();
  const recovered = await open(registration, path);
  const handle = await recovered.getRun(run.id);
  const before = await handle.snapshot();
  expect(before.run.usage.totalTokens).toBe(3);
  expect(before.operations.find((operation) => operation.key === "0:context:2")?.status).toBe(
    "started",
  );
  expect(recovered.events(run.id, 0).some((event) => event.type === "compaction_completed")).toBe(
    false,
  );
  await recovered.resume();
  await handle.result();
  expect(compactor).toHaveBeenCalledTimes(2);
  expect(tool).toHaveBeenCalledTimes(1);
  expect((await handle.snapshot()).run.usage.totalTokens).toBe(13);
});

it("preserves legacy pending requests when upgrading schema five", async () => {
  const path = join(directory(), "legacy.sqlite");
  let calls = 0;
  const requests: CompletionRequest[] = [];
  const compactor = summarize();
  const registration = {
    agent: makeAgent(
      async (request) => {
        requests.push(request);
        return ++calls === 1 ? toolResponse() : done();
      },
      [lookup(async () => large)],
    ),
    version: "1",
    compaction: policy(compactor),
  };
  const original = await open(registration, path);
  const run = await original.submit(submission);
  await original.close();
  expect(calls).toBe(0);
  const db = new DatabaseSync(path);
  db.exec(
    "UPDATE anvia_durable_owner SET version = 5; UPDATE anvia_durable_runs SET record = json_remove(record, '$.loopCompaction')",
  );
  db.close();
  const recovered = await open(registration, path);
  await recovered.resume();
  const handle = await recovered.getRun(run.id);
  await handle.result();
  expect(compactor).not.toHaveBeenCalled();
  expect(JSON.stringify(requests[1]!.chatHistory)).toContain(large);
  expect(
    (await handle.snapshot()).operations.some((operation) => operation.kind === "context"),
  ).toBe(false);
});

it("backs up and restores per-call projections with their usage and progress", async () => {
  const dir = directory();
  const path = join(dir, "runs.sqlite");
  let calls = 0;
  const registration = {
    agent: makeAgent(
      async () => (++calls === 1 ? toolResponse() : done()),
      [lookup(async () => large)],
    ),
    version: "1",
    compaction: policy(),
  };
  const runtime = await open(registration, path);
  const run = await runtime.submit(submission);
  await run.result();
  expectJournalRequests(runtime, run.id);
  const before = await run.snapshot();
  await runtime.close();
  const archive = join(dir, "backup.sqlite");
  const restored = join(dir, "restored.sqlite");
  await backupSqlite(path, archive);
  await restoreSqlite(archive, restored);
  const reopened = await open(registration, restored);
  expect(parseDurableSnapshot(await (await reopened.getRun(run.id)).snapshot())).toEqual(
    parseDurableSnapshot(before),
  );
});
