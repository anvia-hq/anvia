import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest, CompletionResponse } from "@anvia/core/completion";
import type { AgentHook } from "@anvia/core/internal/agent";
import { DurableRuntime, type DurableAgentRegistration, type DurableRun } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const children: ChildProcess[] = [];
const runtimes: DurableRuntime[] = [];
const directories: string[] = [];

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

function directory() {
  const path = mkdtempSync(join(tmpdir(), "durable-hooks-"));
  directories.push(path);
  return path;
}

async function open(
  hook: AgentHook | undefined,
  tool = vi.fn(async () => "tool result"),
  options: {
    path?: string;
    requiresApproval?: boolean;
    model?: (request: CompletionRequest) => Promise<CompletionResponse>;
  } = {},
) {
  const model = vi.fn(
    options.model ??
      (async (request: CompletionRequest) => (hasToolResult(request) ? done() : toolResponse())),
  );
  const agent = makeAgent(model, [lookup(tool)]);
  const registration: DurableAgentRegistration = { agent, version: "1" };
  if (hook !== undefined) registration.hooks = { mode: "record", hook };
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(options.path ?? join(directory(), "runs.sqlite")),
    agents: [registration],
  });
  runtimes.push(runtime);
  return { runtime, tool, model };
}

const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "one",
  prompt: "hello",
};

async function status(run: DurableRun, expected: string) {
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe(expected), {
    timeout: 4000,
  });
}

describe("recorded control hooks", () => {
  it("skips a tool call and tells the model why", async () => {
    const hook: AgentHook = { onToolCall: ({ tool }) => tool.skip("not allowed") };
    const { runtime, tool, model } = await open(hook);
    const run = await runtime.submit(submission);
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(tool).not.toHaveBeenCalled();
    const second = model.mock.calls[1]![0];
    expect(JSON.stringify(second)).toContain("not allowed");
  });

  it("terminates the run from a tool hook (the run fails with the reason)", async () => {
    const hook: AgentHook = { onToolCall: ({ tool }) => tool.cancel("stop here") };
    const { runtime, tool } = await open(hook);
    const run = await runtime.submit(submission);
    await status(run, "failed");
    expect((await run.snapshot()).run.error).toContain("stop here");
    expect(tool).not.toHaveBeenCalled();
  });

  it("cancels from onRunStart and onCompletionCall", async () => {
    const start = await open({ onRunStart: () => ({ type: "terminate", reason: "no" }) });
    const first = await start.runtime.submit(submission);
    await status(first, "failed");
    expect(start.model).not.toHaveBeenCalled();

    const call = await open({ onCompletionCall: () => ({ type: "terminate", reason: "no" }) });
    const second = await call.runtime.submit(submission);
    await status(second, "failed");
    expect(call.model).not.toHaveBeenCalled();
  });

  it("suspends for an approval requested by the hook, then runs the tool once", async () => {
    const onToolCall = vi.fn(({ tool }: Parameters<NonNullable<AgentHook["onToolCall"]>>[0]) =>
      tool.requestApproval({ reason: "check" }),
    );
    const { runtime, tool } = await open({ onToolCall });
    const run = await runtime.submit(submission);
    await status(run, "waiting");
    const pending = (await run.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Missing approval");
    expect(tool).not.toHaveBeenCalled();
    await run.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(tool).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledTimes(1);
  });

  it("fails the run when a hook throws, and runs it again under a new key after retry", async () => {
    let calls = 0;
    const onToolCall = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error("policy service down");
      return undefined;
    });
    const { runtime, tool } = await open({ onToolCall });
    const run = await runtime.submit(submission);
    await status(run, "failed");
    expect(tool).not.toHaveBeenCalled();
    expect(JSON.stringify((await run.snapshot()).run)).toContain("policy service down");
    await run.retry();
    expect(await run.result()).toMatchObject({ output: "done" });
    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(tool).toHaveBeenCalledTimes(1);
  });

  it("rejects a hook that is not a recorded control hook, and a bad marker", async () => {
    await expect(open({ onToolResult: () => undefined })).rejects.toThrow(/onToolResult/);
    const agent = makeAgent(async () => done());
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent, version: "1", hooks: { mode: "observe" } as never }],
      }),
    ).rejects.toThrow(/unknown hooks mode/);
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent, version: "1", hooks: { mode: "record" } as never }],
      }),
    ).rejects.toThrow(/without a hook object/);
  });

  it("installs no hook without the marker and reports the recorded hooks", async () => {
    const hook: AgentHook = {
      onToolCall: ({ tool }) => tool.skip("no"),
      onRunStart: () => undefined,
    };
    const plain = await open(undefined);
    expect(plain.runtime.compatibility()[0]).toMatchObject({ recordedHooks: [] });
    const run = await plain.runtime.submit(submission);
    await run.result();
    expect(plain.tool).toHaveBeenCalledTimes(1);

    const recorded = await open(hook);
    const report = recorded.runtime.compatibility()[0]!;
    expect(report.recordedHooks).toEqual(["onRunStart", "onToolCall"]);
    expect(Object.isFrozen(report.recordedHooks)).toBe(true);
  });
});

async function crash(crashAt: "hook" | "model") {
  const dir = directory();
  const database = join(dir, "runs.sqlite");
  const effects = join(dir, "effects.txt");
  const child = fork(
    fileURLToPath(new URL("./fixtures/hook-worker.ts", import.meta.url)),
    [database, effects, crashAt],
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
    child.once("exit", () => reject(new Error(`Worker exited before checkpoint: ${stderr}`)));
    child.once("error", reject);
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  return { id, database, effects };
}

describe("recorded control hooks after SIGKILL", () => {
  itSqlite(
    "reuses the recorded decision without calling the hook again",
    async () => {
      const { id, database, effects } = await crash("model");
      expect(readFileSync(effects, "utf8")).toBe("hook\n");
      const onToolCall = vi.fn(({ tool }: Parameters<NonNullable<AgentHook["onToolCall"]>>[0]) =>
        tool.cancel("the hook must not run again"),
      );
      const { runtime, tool } = await open({ onToolCall }, undefined, { path: database });
      await runtime.resume();
      const run = await runtime.getRun(id);
      expect(await run.result()).toMatchObject({ output: "done" });
      expect(onToolCall).not.toHaveBeenCalled();
      expect(tool).not.toHaveBeenCalled();
      expect(readFileSync(effects, "utf8")).toBe("hook\n");
    },
    15000,
  );

  itSqlite(
    "does not run a hook that stopped before recording; the run needs attention",
    async () => {
      const { id, database } = await crash("hook");
      const onToolCall = vi.fn(() => undefined);
      const { runtime, tool } = await open({ onToolCall }, undefined, { path: database });
      await runtime.resume();
      const run = await runtime.getRun(id);
      await status(run, "needs_attention");
      const snapshot = await run.snapshot();
      expect(snapshot.run.blockedOperation).toMatch(/:hook:onToolCall:0:call-1$/);
      expect(onToolCall).not.toHaveBeenCalled();
      expect(tool).not.toHaveBeenCalled();
    },
    15000,
  );
});
