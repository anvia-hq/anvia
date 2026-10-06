import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "@anvia/core/agent";
import type { CompletionModelStreamEvent, StreamingCompletionModel } from "@anvia/core/completion";
import type { AnyTool } from "@anvia/core/tool";
import { DurableRuntime, defineTask, type DurableAgentRegistration } from "../src/index.js";
import { parseDurableEvent, parseDurableSnapshot } from "../src/protocol.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { backupSqlite, restoreSqlite } from "../src/maintenance.js";
import {
  done,
  hasToolResult,
  lookup,
  makeAgent,
  makeStreamingAgent,
  response,
  toolResponse,
} from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const children: ChildProcess[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "stream",
  prompt: "hello",
};

function database() {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-stream-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

function streamingAgent(
  streamCompletion: StreamingCompletionModel["streamCompletion"],
  tools: AnyTool[] = [],
) {
  const stream = vi.fn(streamCompletion);
  const agent = makeStreamingAgent(stream, tools);
  const completion = vi.spyOn(agent.model, "completion");
  return { agent, completion, stream };
}

async function* textStream(): AsyncIterable<CompletionModelStreamEvent> {
  yield { type: "text_delta", delta: "do" };
  yield { type: "text_delta", delta: "ne" };
  yield { type: "final", response: done() };
}

async function open(
  agent: Agent<unknown>,
  path = ":memory:",
  options: Partial<DurableAgentRegistration> = {},
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", stream: true, ...options }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function events(run: { stream(): AsyncIterable<unknown> }) {
  const saved = [];
  for await (const event of run.stream()) saved.push(parseDurableEvent(event));
  return saved;
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("streams persisted deltas before completion and detaches subscribers without cancelling execution", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { agent, completion, stream } = streamingAgent(async function* () {
    yield { type: "reasoning_delta", delta: "thinking", id: "reason", contentType: "summary" };
    yield { type: "text_delta", delta: "do" };
    await held;
    yield { type: "text_delta", delta: "ne" };
    yield { type: "final", response: response([]) };
  });
  const runtime = await open(agent);
  const run = await runtime.submit(submission);
  const controller = new AbortController();
  const iterator = run.stream({ abortSignal: controller.signal })[Symbol.asyncIterator]();
  let cursor = 0;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) throw new Error("Stream ended before delta");
      parseDurableEvent(next.value);
      cursor = next.value.sequence;
      if (next.value.type === "model_delta" && JSON.stringify(next.value.data).includes('"do"'))
        break;
    }
    expect(parseDurableSnapshot(await run.snapshot()).run.status).toBe("running");
    controller.abort(new Error("Disconnected"));
    await expect(iterator.next()).rejects.toThrow("Disconnected");
    release();
    const remaining = [];
    for await (const event of run.stream({ after: cursor })) remaining.push(event);
    expect(remaining.filter((event) => event.type === "model_delta")).toMatchObject([
      { data: { event: { type: "text_delta", turn: 1, delta: "ne" } } },
    ]);
    expect(await run.result()).toMatchObject({ output: "done" });
    const saved = await events(run);
    const started = saved.find((event) => event.type === "model_attempt_started")!;
    const attemptId = (started.data as { attemptId: string }).attemptId;
    expect(
      saved
        .filter((event) => event.type === "model_delta")
        .every((event) => (event.data as { attemptId: string }).attemptId === attemptId),
    ).toBe(true);
    expect(saved.find((event) => event.type === "model_completed")).toMatchObject({
      data: { attemptId, result: { rawResponse: null } },
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(completion).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("replays completed streams after reopening without duplicating deltas or invoking the model", async () => {
  const path = database();
  const { agent, stream, completion } = streamingAgent(textStream);
  const runtime = await open(agent, path);
  const run = await runtime.submit(submission);
  await run.result();
  const saved = await events(run);
  await runtime.close();
  const reopened = await open(agent, path);
  await reopened.resume();
  const restored = await reopened.getRun(run.id);
  expect(await restored.result()).toMatchObject({ output: "done" });
  expect(await events(restored)).toEqual(saved);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(completion).not.toHaveBeenCalled();
});

it("retries failed streams under new attempt identities and preserves the retry budget", async () => {
  let calls = 0;
  const { agent, completion } = streamingAgent(async function* () {
    if (++calls < 3) {
      yield { type: "text_delta", delta: "discard me" };
      yield { type: "error", error: new Error("provider failed") };
    } else yield* textStream();
  });
  const runtime = await open(agent, ":memory:", {
    modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
  });
  const run = await runtime.submit(submission);
  await expect(run.result()).rejects.toThrow("provider failed");
  expect(calls).toBe(2);
  await run.retry();
  expect(await run.result()).toMatchObject({ output: "done" });
  const saved = await events(run);
  const attempts = saved
    .filter((event) => event.type === "model_attempt_started")
    .map((event) => event.data as { attemptId: string; attempt: number });
  expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 1]);
  expect(new Set(attempts.map((attempt) => attempt.attemptId)).size).toBe(3);
  expect(saved.filter((event) => event.type === "model_attempt_failed")).toHaveLength(2);
  expect((await run.snapshot()).run.usage.totalTokens).toBe(3);
  expect(completion).not.toHaveBeenCalled();
});

it("keeps completed streamed model and tool checkpoints when a later stream is interrupted", async () => {
  const path = database();
  const tool = vi.fn(async () => "saved result");
  const first = streamingAgent(
    async function* (request, options) {
      if (!hasToolResult(request)) {
        yield { type: "tool_call_delta", id: "call-1", name: "lookup", argumentsDelta: "{}" };
        yield { type: "final", response: toolResponse() };
      } else {
        yield { type: "text_delta", delta: "partial" };
        await waitForAbort(options?.abortSignal);
      }
    },
    [lookup(tool)],
  );
  const runtime = await open(first.agent, path);
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(first.stream).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      runtime
        .events(run.id, 0)
        .some(
          (event) => event.type === "model_delta" && JSON.stringify(event.data).includes("partial"),
        ),
    ).toBe(true),
  );
  await runtime.close();
  const resumed = streamingAgent(textStream, [lookup(tool)]);
  const reopened = await open(resumed.agent, path, { stream: false });
  await reopened.resume();
  const restored = await reopened.getRun(run.id);
  expect(await restored.result()).toMatchObject({ output: "done" });
  expect(resumed.stream).toHaveBeenCalledTimes(1);
  expect(tool).toHaveBeenCalledTimes(1);
  expect((await restored.snapshot()).run.usage.totalTokens).toBe(6);
  const saved = await events(restored);
  expect(
    saved.filter(
      (event) =>
        event.type === "model_delta" && JSON.stringify(event.data).includes("tool_call_delta"),
    ),
  ).toHaveLength(1);
});

it("preserves tool approval and continues with streaming after a restart", async () => {
  const path = database();
  const tool = vi.fn(async () => "approved");
  const { agent, completion } = streamingAgent(
    async function* (request) {
      if (hasToolResult(request)) yield* textStream();
      else yield { type: "final", response: toolResponse() };
    },
    [{ ...lookup(tool), requiresApproval: true }],
  );
  const runtime = await open(agent, path);
  const run = await runtime.submit(submission);
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
  const outcome = (await run.snapshot()).run.outcome;
  if (outcome?.type !== "interaction") throw new Error("Missing interaction");
  expect(tool).not.toHaveBeenCalled();
  await runtime.close();
  const reopened = await open(agent, path);
  const restored = await reopened.getRun(run.id);
  await restored.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
  expect(await restored.result()).toMatchObject({ output: "done" });
  expect(tool).toHaveBeenCalledTimes(1);
  expect(completion).not.toHaveBeenCalled();
});

it("uses the same streaming execution for graph nodes and owned agent tasks", async () => {
  const { agent, stream, completion } = streamingAgent(textStream);
  const parent = defineTask({
    name: "parent",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.string(),
    initial: () => null,
    run: async (ctx) => {
      const id = ctx.spawnAgent("child", { agentId: agent.id, prompt: "hello" });
      const child = ctx.children().find((child) => child.id === id)!;
      if (child.outcome?.status === "completed") return { status: "completed", output: "done" };
      return {
        status: "waiting",
        checkpoint: null,
        wait: { type: "children", ids: [id], policy: "allSettled" },
      };
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent, version: "1", stream: true }],
    tasks: [parent],
  });
  runtimes.push(runtime);
  const graph = await runtime.submitGraph({
    sessionId: "graph",
    requestId: "graph",
    tasks: [{ id: "node", agentId: agent.id, prompt: "hello" }],
  });
  const graphEvents = [];
  for await (const event of graph.stream()) graphEvents.push(event);
  expect(graphEvents.some((event) => event.type === "model_delta")).toBe(true);
  const task = await runtime.submitTask(parent, {
    sessionId: "task",
    requestId: "task",
    input: null,
  });
  expect(await task.result()).toBe("done");
  const childRunId = (await task.graph()).nodes.find(
    (node) => node.agentRunId !== undefined,
  )!.agentRunId!;
  const childRun = await runtime.getRun(childRunId);
  expect((await events(childRun)).some((event) => event.type === "model_delta")).toBe(true);
  expect(stream).toHaveBeenCalledTimes(2);
  expect(completion).not.toHaveBeenCalled();
});

it("keeps generate() as the default and rejects unsupported streaming registrations", async () => {
  const { agent, completion, stream } = streamingAgent(textStream);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  const defaultRun = await runtime.submit(submission);
  await defaultRun.result();
  expect((await defaultRun.snapshot()).run.stream).toBeUndefined();
  expect(completion).toHaveBeenCalledTimes(1);
  expect(stream).not.toHaveBeenCalled();
  const store = new SqliteDurableStore(":memory:");
  try {
    await expect(
      DurableRuntime.open({
        store,
        agents: [{ agent: makeAgent(async () => done()), version: "1", stream: true }],
      }),
    ).rejects.toThrow("streaming-capable");
  } finally {
    store.close();
  }
});

it("never checkpoints an invalid structured streamed response", async () => {
  const model = streamingAgent(async function* () {
    yield { type: "text_delta", delta: '{"value":"invalid"}' };
    yield { type: "final", response: response([{ type: "text", text: '{"value":"invalid"}' }]) };
  });
  const agent = new Agent({
    id: "researcher",
    model: model.agent.model,
    outputSchema: z.object({ value: z.number() }),
  });
  const runtime = await open(agent);
  const run = await runtime.submit(submission);
  await expect(run.result()).rejects.toThrow();
  expect((await run.snapshot()).operations[0]?.status).toBe("started");
  expect((await events(run)).some((event) => event.type === "model_completed")).toBe(false);
});

it("recovers persisted partial tokens and completed tools after SIGKILL", async () => {
  const path = database();
  const effects = `${path}.effects`;
  const child = fork(
    fileURLToPath(new URL("./fixtures/stream-worker.ts", import.meta.url)),
    [path, effects],
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
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`Worker exited before checkpoint: ${stderr}`)));
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const tool = vi.fn(async () => "saved result");
  const { agent, stream, completion } = streamingAgent(textStream, [lookup(tool)]);
  const runtime = await open(agent, path);
  await runtime.resume();
  const run = await runtime.getRun(id);
  expect(await run.result()).toMatchObject({ output: "done" });
  const saved = await events(run);
  const partial = saved.find(
    (event) => event.type === "model_delta" && JSON.stringify(event.data).includes("partial"),
  );
  expect(partial).toBeDefined();
  const completed = saved.filter((event) => event.type === "model_completed").at(-1)!;
  expect((partial!.data as { attemptId: string }).attemptId).not.toBe(
    (completed.data as { attemptId: string }).attemptId,
  );
  expect(stream).toHaveBeenCalledTimes(1);
  expect(tool).not.toHaveBeenCalled();
  expect(completion).not.toHaveBeenCalled();
  expect(readFileSync(effects, "utf8")).toBe("effect\n");
}, 15000);

it("fails oversized delta persistence without retrying the provider", async () => {
  const { agent, stream } = streamingAgent(async function* () {
    yield { type: "text_delta", delta: "x".repeat(3000) };
    yield { type: "final", response: response([{ type: "text", text: "x".repeat(3000) }]) };
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    limits: { maxPayloadBytes: 2000 },
    agents: [
      {
        agent,
        version: "1",
        stream: true,
        modelRetry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
      },
    ],
  });
  runtimes.push(runtime);
  const run = await runtime.submit(submission);
  await expect(run.result()).rejects.toThrow("payload byte limit");
  expect(stream).toHaveBeenCalledTimes(1);
  expect(runtime.health().ready).toBe(true);
  const saved = await events(run);
  expect(saved.filter((event) => event.type === "model_delta")).toHaveLength(0);
  expect(saved.filter((event) => event.type === "model_attempt_failed")).toHaveLength(1);
});

it("persists cancellation of a partial stream and never resumes it", async () => {
  const path = database();
  const { agent, stream } = streamingAgent(async function* (_request, options) {
    yield { type: "text_delta", delta: "partial" };
    await waitForAbort(options?.abortSignal);
  });
  const runtime = await open(agent, path);
  const run = await runtime.submit(submission);
  await vi.waitFor(() =>
    expect(runtime.events(run.id, 0).some((event) => event.type === "model_delta")).toBe(true),
  );
  await run.cancel();
  await expect(run.result()).rejects.toMatchObject({ status: "cancelled" });
  await runtime.close();
  const reopened = await open(agent, path);
  await reopened.resume();
  const restored = await reopened.getRun(run.id);
  expect((await restored.snapshot()).run.status).toBe("cancelled");
  expect((await events(restored)).some((event) => event.type === "model_completed")).toBe(false);
  expect(stream).toHaveBeenCalledTimes(1);
});

it("treats a delta write failure as fatal storage failure and recovers with a new attempt", async () => {
  const path = database();
  const store = new SqliteDurableStore(path);
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementation((callback) =>
    transaction((tx) =>
      callback({
        ...tx,
        appendEvent(id, type, data) {
          if (type === "model_delta") throw new Error("injected delta write failure");
          tx.appendEvent(id, type, data);
        },
      }),
    ),
  );
  const { agent, stream } = streamingAgent(textStream);
  const fatal = vi.fn();
  const runtime = await DurableRuntime.open({
    store,
    agents: [
      {
        agent,
        version: "1",
        stream: true,
        modelRetry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
      },
    ],
    onFatalError: fatal,
  });
  runtimes.push(runtime);
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(runtime.health().status).toBe("failed"));
  expect(fatal).toHaveBeenCalledTimes(1);
  expect(stream).toHaveBeenCalledTimes(1);
  await expect(run.snapshot()).rejects.toThrow("Durable storage failed");
  await runtime.close();
  const reopened = await open(agent, path);
  await reopened.resume();
  const restored = await reopened.getRun(run.id);
  expect(await restored.result()).toMatchObject({ output: "done" });
  const saved = await events(restored);
  expect(saved.filter((event) => event.type === "model_attempt_started")).toHaveLength(2);
  expect(saved.filter((event) => event.type === "model_delta")).toHaveLength(2);
});

it("preserves persisted deltas and attempt identities through backup and restore", async () => {
  const path = database();
  const { agent, stream } = streamingAgent(textStream);
  const runtime = await open(agent, path);
  const run = await runtime.submit(submission);
  await run.result();
  const saved = await events(run);
  await runtime.close();
  const archive = `${path}.backup`;
  const restored = `${path}.restored`;
  expect((await backupSqlite(path, archive)).schemaVersion).toBe(4);
  expect((await restoreSqlite(archive, restored)).schemaVersion).toBe(4);
  const reopened = await open(agent, restored);
  await reopened.resume();
  expect(await events(await reopened.getRun(run.id))).toEqual(saved);
  expect(stream).toHaveBeenCalledTimes(1);
});
