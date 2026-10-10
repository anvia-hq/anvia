import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import { parseDurableEvent, parseDurableSnapshot, parseDurableSteering } from "../src/protocol.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import {
  done,
  hasToolResult,
  lookup,
  makeAgent,
  makeStreamingAgent,
  toolResponse,
} from "./helpers.js";

const children: ChildProcess[] = [];
const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "request",
  prompt: "hello",
};
const input = { prompt: "Focus on the recovery behavior." };

function database() {
  const directory = mkdtempSync(join(tmpdir(), "anvia-steering-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function abort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
async function open(
  agent: Agent<unknown>,
  path = ":memory:",
  options: Partial<DurableAgentRegistration> = {},
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", ...options }],
  });
  runtimes.push(runtime);
  return runtime;
}
function messages(request: CompletionRequest) {
  return request.chatHistory;
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

it.each([false, true])(
  "steers an in-flight answer at the next boundary (stream=%s)",
  async (stream) => {
    const held = gate();
    const requests: CompletionRequest[] = [];
    const completion = async (request: CompletionRequest) => {
      requests.push(request);
      if (requests.length === 1) await held.promise;
      return done();
    };
    const agent = stream
      ? makeStreamingAgent(async function* (request) {
          yield { type: "final", response: await completion(request) };
        })
      : makeAgent(completion);
    const runtime = await open(agent, ":memory:", { stream });
    const run = await runtime.submit(submission);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const receipt = await run.steer(input, { requestId: "correction" });
    expect(await run.steer(input, { requestId: "correction" })).toEqual(receipt);
    await expect(run.steer({ prompt: "different" }, { requestId: "correction" })).rejects.toThrow(
      "different input",
    );
    expect(requests).toHaveLength(1);
    held.release();
    const outcome = await run.result();
    expect(requests).toHaveLength(2);
    expect(messages(requests[0]!)).not.toContainEqual({ role: "user", content: input.prompt });
    expect(messages(requests[1]!).at(-1)).toEqual({ role: "user", content: input.prompt });
    expect(outcome.messages.filter((message) => message.content === input.prompt)).toHaveLength(1);
    const events = [];
    for await (const event of run.stream()) events.push(parseDurableEvent(event));
    expect(events.filter((event) => event.type === "steering_queued")).toHaveLength(1);
    expect(events.filter((event) => event.type === "steering_applied")).toMatchObject([
      { data: { id: receipt.id, epoch: 0, turn: 1 } },
    ]);
    expect(parseDurableSnapshot(await run.snapshot()).run.steering?.pending).toEqual([]);
    expect(await run.steer(input, { requestId: "correction" })).toEqual(receipt);
    await expect(run.steer(input)).rejects.toThrow("no longer accepting");
    const followup = await runtime.submit({ ...submission, requestId: "next", prompt: "continue" });
    await followup.result();
    expect(messages(requests[2]!)).toContainEqual({ role: "user", content: input.prompt });
  },
);

it("preserves an empty boundary on restart and applies new input only after replaying the saved request", async () => {
  const path = database();
  const firstModel = vi.fn(async (_request, signal) => abort(signal));
  const first = await open(makeAgent(firstModel), path);
  const run = await first.submit(submission);
  await vi.waitFor(() => expect(firstModel).toHaveBeenCalledTimes(1));
  const savedRequest = firstModel.mock.calls[0]![0];
  await run.steer(input, { requestId: "saved" });
  await first.close();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const second = await open(makeAgent(model), path);
  await second.resume();
  const restored = await second.getRun(run.id);
  await restored.result();
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[0]![0]).toEqual(savedRequest);
  expect(messages(model.mock.calls[1]![0]).at(-1)).toEqual({ role: "user", content: input.prompt });
});

it("replays applied steering and committed tools without duplicating them", async () => {
  const path = database();
  const held = gate();
  const tool = vi.fn(async () => {
    await held.promise;
    return "stored result";
  });
  const model = vi.fn(async (request: CompletionRequest, signal?: AbortSignal) =>
    hasToolResult(request) ? abort(signal) : toolResponse(),
  );
  const first = await open(makeAgent(model, [lookup(tool)]), path);
  const run = await first.submit(submission);
  await vi.waitFor(() => expect(tool).toHaveBeenCalledTimes(1));
  await run.steer(input, { requestId: "first" });
  expect(model).toHaveBeenCalledTimes(1);
  held.release();
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(2));
  const savedRequest = model.mock.calls[1]![0];
  await run.steer(
    { messages: [{ role: "user", content: "One more thing" }] },
    { requestId: "second" },
  );
  await first.close();
  const resumedModel = vi.fn(async (_request: CompletionRequest) => done());
  const second = await open(makeAgent(resumedModel, [lookup(tool)]), path);
  await second.resume();
  const restored = await second.getRun(run.id);
  const outcome = await restored.result();
  expect(tool).toHaveBeenCalledTimes(1);
  expect(resumedModel).toHaveBeenCalledTimes(2);
  expect(resumedModel.mock.calls[0]![0]).toEqual(savedRequest);
  expect(messages(resumedModel.mock.calls[1]![0]).at(-1)).toEqual({
    role: "user",
    content: "One more thing",
  });
  expect(outcome.messages.filter((message) => message.content === input.prompt)).toHaveLength(1);
  const applied = second.events(run.id, 0).filter((event) => event.type === "steering_applied");
  expect(applied.map((event) => (event.data as { id: string }).id)).toEqual(["first", "second"]);
});

it("keeps steering pending across approval and restart without granting approval", async () => {
  const path = database();
  const tool = vi.fn(async () => "approved result");
  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : toolResponse(),
  );
  const agent = makeAgent(model, [{ ...lookup(tool), requiresApproval: true }]);
  const first = await open(agent, path);
  const run = await first.submit(submission);
  await vi.waitFor(async () => expect((await run.status()).status).toBe("waiting"));
  await run.steer(input);
  expect((await run.status()).status).toBe("waiting");
  expect(tool).not.toHaveBeenCalled();
  await first.close();
  const second = await open(agent, path);
  const restored = await second.getRun(run.id);
  const pending = (await restored.snapshot()).run.outcome;
  if (pending?.type !== "interaction") throw new Error("Missing approval");
  await restored.respond(pending.interaction.id, { type: "tool-approval", approved: true });
  await restored.result();
  expect(tool).toHaveBeenCalledTimes(1);
  expect(messages(model.mock.calls[1]![0]).at(-1)).toEqual({ role: "user", content: input.prompt });
});

it("applies queued input before the first model and validates user-only transport input", async () => {
  const held = gate();
  const model = vi.fn(async (request: CompletionRequest) => {
    if (request.chatHistory.at(-1)?.content === "hello") await held.promise;
    return done();
  });
  const runtime = await open(makeAgent(model));
  const first = await runtime.submit(submission);
  const queued = await runtime.submit(
    { ...submission, requestId: "queued", prompt: "next" },
    { enqueue: true },
  );
  const body = parseDurableSteering({
    input: { messages: [{ role: "user", content: [{ type: "text", text: "queued correction" }] }] },
    requestId: "queued",
  });
  await queued.steer(body.input, { requestId: body.requestId! });
  await expect(
    queued.steer({ messages: [{ role: "system", content: "invalid" }] } as never),
  ).rejects.toThrow("Invalid");
  expect(() => parseDurableSteering({ input: { prompt: "x", messages: [] } })).toThrow("Invalid");
  held.release();
  await first.result();
  await queued.result();
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1]![0].chatHistory.at(-1)?.content).toEqual([
    { type: "text", text: "queued correction" },
  ]);
});

it("does not extend the model-turn budget", async () => {
  const held = gate();
  const model = vi.fn(async () => {
    await held.promise;
    return done();
  });
  const base = makeAgent(model);
  const runtime = await open(new Agent({ id: base.id, model: base.model, maxTurns: 0 }));
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  await run.steer(input);
  held.release();
  await expect(run.result()).rejects.toThrow("Reached max turn limit: 0");
  expect(model).toHaveBeenCalledTimes(1);
  expect((await run.snapshot()).run.exhaustion?.messages).toContainEqual({
    role: "user",
    content: input.prompt,
  });
});

it("survives SIGKILL with applied and pending input without repeating a committed effect", async () => {
  const path = database();
  const effects = `${path}.effects`;
  const child = fork(
    fileURLToPath(new URL("./fixtures/steering-worker.ts", import.meta.url)),
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
  const { id, request } = await new Promise<{ id: string; request: CompletionRequest }>(
    (resolve, reject) => {
      child.once("message", (message) =>
        resolve(message as { id: string; request: CompletionRequest }),
      );
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`Worker exited before checkpoint: ${stderr}`)));
    },
  );
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const tool = vi.fn(async () => "stored result");
  const runtime = await open(makeAgent(model, [lookup(tool)]), path);
  await runtime.resume();
  const run = await runtime.getRun(id);
  const outcome = await run.result();
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[0]![0]).toEqual(request);
  expect(tool).not.toHaveBeenCalled();
  expect(readFileSync(effects, "utf8")).toBe("effect\n");
  expect(
    outcome.messages.filter((message) => message.content === "applied before crash"),
  ).toHaveLength(1);
  expect(
    outcome.messages.filter((message) => message.content === "queued before crash"),
  ).toHaveLength(1);
  expect(runtime.events(id, 0).filter((event) => event.type === "steering_applied")).toHaveLength(
    2,
  );
}, 15000);

it("rejects input in the gap between the final core drain and the outcome commit", async () => {
  const agent = makeAgent(async () => done());
  const generate = agent.generate.bind(agent);
  const reached = gate();
  const release = gate();
  vi.spyOn(agent, "generate").mockImplementation(async (options) => {
    const outcome = await generate(options);
    reached.release();
    await release.promise;
    return outcome;
  });
  const runtime = await open(agent);
  const run = await runtime.submit(submission);
  await reached.promise;
  try {
    expect((await run.status()).status).toBe("running");
    await expect(run.steer(input)).rejects.toThrow("no longer accepting");
  } finally {
    release.release();
  }
  await run.result();
});
