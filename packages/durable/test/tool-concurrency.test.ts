import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { recovery, tools, twoCalls as parallelCalls } from "./fixtures/parallel-crash-worker.js";
import type { AnyTool } from "@anvia/core/tool";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, hasToolResult, makeAgent, response } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

const twoCalls = () =>
  response([
    { type: "tool-call", toolCallId: "call-a", toolName: "slow", input: {} },
    { type: "tool-call", toolCallId: "call-b", toolName: "slow", input: {} },
  ]);

function measuredTool() {
  const state = { active: 0, peak: 0, calls: 0 };
  const tool: AnyTool = {
    name: "slow",
    definition: () => ({
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object", properties: {} },
    }),
    call: async () => {
      state.calls += 1;
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      state.active -= 1;
      return "ok";
    },
  };
  return { tool, state };
}

async function runWith(toolConcurrency: number | undefined) {
  const { tool, state } = measuredTool();
  const agent = makeAgent(
    async (request) => (hasToolResult(request) ? done() : twoCalls()),
    [tool],
  );
  const registration: DurableAgentRegistration = {
    agent,
    version: "1",
    toolRecovery: { slow: "safe" },
  };
  if (toolConcurrency !== undefined) registration.toolConcurrency = toolConcurrency;
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [registration],
  });
  runtimes.push(runtime);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "s",
    requestId: "r",
    prompt: "go",
  });
  await run.result();
  return { state, runtime, run };
}

it("runs one tool at a time by default", async () => {
  const { state } = await runWith(undefined);
  expect(state).toMatchObject({ calls: 2, peak: 1 });
});

it("runs the tool calls of one turn concurrently when registered", async () => {
  const { state, runtime } = await runWith(2);
  expect(state).toMatchObject({ calls: 2, peak: 2 });
  expect(runtime.compatibility()[0]).toMatchObject({ toolConcurrency: 2 });
});

it("reports the default concurrency", async () => {
  const { runtime } = await runWith(undefined);
  expect(runtime.compatibility()[0]).toMatchObject({ toolConcurrency: 1 });
});

it("rejects an invalid toolConcurrency", async () => {
  const agent = makeAgent(async () => done());
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent, version: "1", toolConcurrency: bad } as DurableAgentRegistration],
      }),
    ).rejects.toThrow("toolConcurrency must be a positive integer");
  }
});

it("recovers a SIGKILL in the middle of a concurrent turn without repeating committed tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-parallel-"));
  const database = join(directory, "runs.sqlite");
  const effects = join(directory, "effects.txt");
  const child = fork(
    fileURLToPath(new URL("./fixtures/parallel-crash-worker.ts", import.meta.url)),
    [database, effects],
    {
      execArgv: ["--import", import.meta.resolve("tsx")],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  try {
    let stderr = "";
    child.stderr!.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const { id } = await new Promise<{ id: string }>((resolve, reject) => {
      child.once("message", (message) => resolve(message as { id: string }));
      child.once("exit", () => reject(new Error(`Worker exited early: ${stderr}`)));
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    expect(readFileSync(effects, "utf8").split("\n").sort()).toEqual(["", "fast", "stuck"]);

    const model = vi.fn(async (request: CompletionRequest) =>
      hasToolResult(request) ? done() : parallelCalls(),
    );
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(database),
      agents: [
        {
          agent: makeAgent(
            model,
            tools(effects, () => {}),
          ),
          version: "1",
          toolConcurrency: 2,
          toolRecovery: recovery,
        },
      ],
    });
    runtimes.push(runtime);
    await runtime.resume();
    expect(await (await runtime.getRun(id)).result()).toMatchObject({ output: "done" });
    // The committed `fast` call is replayed from the journal; only `stuck` runs again.
    expect(readFileSync(effects, "utf8").split("\n").sort()).toEqual([
      "",
      "fast",
      "stuck",
      "stuck",
    ]);
    expect(model).toHaveBeenCalledTimes(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
