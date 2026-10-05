import { ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  createTool,
  loadSkills,
  skill,
  type CompletionResponse,
  type StreamingCompletionModel,
  type ToolCallContext,
  Usage,
} from "./helpers/imports";

const directories: string[] = [];
const pids = new Set<number>();
const TERMINATION_BOUND_MS = 1_250;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function running(pid: number): Promise<boolean> {
  if (!alive(pid)) return false;
  if (process.platform !== "linux") return true;
  try {
    // Orphaned descendants can remain as zombies until PID 1 reaps them.
    // The command name may contain parentheses, so read state after the last one.
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    return state !== "Z" && state !== "X";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function waitForPid(path: string): Promise<number> {
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (pid > 0) {
        pids.add(pid);
        return pid;
      }
    } catch {}
    await delay(5);
  }
  throw new Error("Child did not acknowledge startup");
}

function resources() {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners = new Map<AbortSignal, Set<unknown>>();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const originalAdd = AbortSignal.prototype.addEventListener;
  const originalRemove = AbortSignal.prototype.removeEventListener;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const timer = originalSet(() => {
      timers.delete(timer);
      callback(...args);
    }, ms);
    timers.add(timer);
    return timer;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    timers.delete(timer as ReturnType<typeof setTimeout>);
    originalClear(timer);
  });
  vi.spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(
    function (this: AbortSignal, type, listener, options) {
      if (type === "abort") {
        const entries = listeners.get(this) ?? new Set();
        entries.add(listener);
        listeners.set(this, entries);
      }
      originalAdd.call(this, type, listener, options);
    },
  );
  vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(
    function (this: AbortSignal, type, listener, options) {
      if (type === "abort") listeners.get(this)?.delete(listener);
      originalRemove.call(this, type, listener, options);
    },
  );
  return () => {
    expect(timers.size).toBe(0);
    expect([...listeners.values()].reduce((sum, entries) => sum + entries.size, 0)).toBe(0);
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "anvia-skill-cancellation-"));
  directories.push(root);
  const directory = join(root, "process-check");
  await mkdir(join(directory, "scripts"), { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    "---\nname: process-check\ndescription: Check process cancellation.\n---\nRun.\n",
  );
  const scripts = {
    run: `const fs = require('node:fs');
if (process.argv[3] === 'ignore') process.on('SIGTERM', () => {});
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
    ok: "process.stdout.write('one\\n'); process.stderr.write('two\\n');",
    fail: "process.stderr.write('no\\n'); process.exit(2);",
    marker: "require('node:fs').writeFileSync(process.argv[2], 'ran'); process.stdout.write('ok');",
    held: `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
fs.writeFileSync(process.argv[3], String(child.pid));
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
  };
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(directory, "scripts", name);
    await writeFile(path, `#!${process.execPath}\n${body}\n`);
    await chmod(path, 0o755);
  }
  const skills = await loadSkills(skill.local(directory));
  const scriptTool = skills.tools.find((item) => item.name === "run_skill_script");
  if (scriptTool === undefined) throw new Error("Missing public skill tool");
  const tool = {
    async call(
      args: { skillName: string; scriptPath: string; args: string[]; timeoutMs: number },
      context: ToolCallContext = {},
    ) {
      return await scriptTool.call(args, context);
    },
  };
  const pidFile = join(root, "pid");
  const args = { skillName: "process-check", scriptPath: "run", args: [pidFile], timeoutMs: 5_000 };
  return { root, directory, pidFile, args, tool, skills };
}

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    for (const pid of pids) {
      try {
        if (await running(pid)) process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    for (const pid of pids) {
      for (let attempt = 0; (await running(pid)) && attempt < 200; attempt++) await delay(5);
      expect(await running(pid)).toBe(false);
    }
  } finally {
    pids.clear();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
});

describe.skipIf(process.platform === "win32")("skill direct-child cancellation", () => {
  it("rejects a running public tool with AbortError only after direct exit", async () => {
    const f = await fixture();
    const checkResources = resources();
    const controller = new AbortController();
    const result = f.tool.call(f.args, { abortSignal: controller.signal });
    const error = result.catch((value: unknown) => value);
    const pid = await waitForPid(f.pidFile);
    controller.abort("stop");
    expect(await error).toMatchObject({ name: "AbortError", cause: "stop" });
    expect(alive(pid)).toBe(false);
    checkResources();
  });

  it("does not spawn when pre-aborted and retains ordinary output", async () => {
    const f = await fixture();
    const checkResources = resources();
    const marker = join(f.root, "marker");
    const args = { ...f.args, scriptPath: "marker", args: [marker] };
    const controller = new AbortController();
    controller.abort("already stopped");
    await expect(f.tool.call(args, { abortSignal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(f.tool.call(args)).resolves.toBe("stdout:\nok");
    expect(await readFile(marker, "utf8")).toBe("ran");
    checkResources();
  });

  it("preserves stdout and stderr formatting and the nonzero-exit diagnostic", async () => {
    const f = await fixture();
    const checkResources = resources();
    await expect(f.tool.call({ ...f.args, scriptPath: "ok" })).resolves.toBe(
      "stdout:\none\n\n\nstderr:\ntwo\n",
    );
    await expect(f.tool.call({ ...f.args, scriptPath: "fail" })).rejects.toThrow(
      "Skill script exited with code 2: stderr:\nno\n",
    );
    checkResources();
  });

  it("times out a direct child and waits for its death", async () => {
    const f = await fixture();
    const checkResources = resources();
    const result = f.tool.call({ ...f.args, timeoutMs: 300 }).catch((error: unknown) => error);
    const pid = await waitForPid(f.pidFile);
    expect(await result).toMatchObject({ message: "Skill script timed out after 300ms" });
    expect(alive(pid)).toBe(false);
    checkResources();
  });

  it("preserves spawn failure codes and disposes timers and listeners", async () => {
    const f = await fixture();
    await rm(join(f.directory, "scripts", "run"));
    const checkResources = resources();
    const controller = new AbortController();
    await expect(f.tool.call(f.args, { abortSignal: controller.signal })).rejects.toMatchObject({
      code: "ENOENT",
    });
    controller.abort();
    checkResources();
  });

  it("does not send a late kill after success", async () => {
    const f = await fixture();
    const checkResources = resources();
    const kill = vi.spyOn(ChildProcess.prototype, "kill");
    const controller = new AbortController();
    const result = await f.tool.call(
      { ...f.args, scriptPath: "ok" },
      { abortSignal: controller.signal },
    );
    controller.abort();
    expect(result).toBe("stdout:\none\n\n\nstderr:\ntwo\n");
    expect(kill).not.toHaveBeenCalled();
    checkResources();
  });

  it.each(["abort", "timeout"])("preserves the first %s cause during escalation", async (first) => {
    const f = await fixture();
    const checkResources = resources();
    const controller = new AbortController();
    let settlements = 0;
    const result = f.tool
      .call(
        { ...f.args, args: [f.pidFile, "ignore"], timeoutMs: first === "abort" ? 200 : 300 },
        { abortSignal: controller.signal },
      )
      .catch((error: unknown) => {
        settlements++;
        return error;
      });
    const pid = await waitForPid(f.pidFile);
    if (first === "timeout") await delay(350);
    controller.abort("first abort");
    expect(await result).toMatchObject(
      first === "abort"
        ? { name: "AbortError", cause: "first abort" }
        : { message: "Skill script timed out after 300ms" },
    );
    expect(settlements).toBe(1);
    expect(alive(pid)).toBe(false);
    checkResources();
  });

  it("escalates after 250ms when SIGTERM is ignored within the 1250ms bound", async () => {
    const f = await fixture();
    const checkResources = resources();
    const kill = vi.spyOn(ChildProcess.prototype, "kill");
    const controller = new AbortController();
    const result = f.tool
      .call({ ...f.args, args: [f.pidFile, "ignore"] }, { abortSignal: controller.signal })
      .catch((error: unknown) => error);
    const pid = await waitForPid(f.pidFile);
    const start = performance.now();
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(performance.now() - start).toBeLessThan(TERMINATION_BOUND_MS);
    expect(kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(alive(pid)).toBe(false);
    checkResources();
  });

  it("settles on confirmed direct exit despite descendant-held pipes", async () => {
    const f = await fixture();
    const descendantFile = join(f.root, "descendant");
    const checkResources = resources();
    const controller = new AbortController();
    const result = f.tool
      .call(
        { ...f.args, scriptPath: "held", args: [f.pidFile, descendantFile] },
        { abortSignal: controller.signal },
      )
      .catch((error: unknown) => error);
    const pid = await waitForPid(f.pidFile);
    const descendant = await waitForPid(descendantFile);
    const start = performance.now();
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(performance.now() - start).toBeLessThan(TERMINATION_BOUND_MS);
    expect(alive(pid)).toBe(false);
    expect(alive(descendant)).toBe(true);
    checkResources();
  });

  it("cancels Agent.generate and stream consumers repeatedly without retained resources", async () => {
    const f = await fixture();
    const checkResources = resources();
    const model = {
      provider: "test",
      modelId: "test",
      capabilities: {
        streaming: true,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion() {
        return {
          choice: [
            {
              type: "tool-call" as const,
              toolCallId: "call",
              toolName: "run_skill_script",
              input: f.args,
            },
          ],
          usage: Usage.empty(),
          rawResponse: {},
          finishReason: "tool-calls" as const,
        };
      },
      async *streamCompletion() {
        const response = await this.completion();
        yield {
          type: "final" as const,
          response: {
            ...response,
            choice: [
              ...response.choice,
              {
                type: "tool-call" as const,
                toolCallId: "ready",
                toolName: "wait_for_process",
                input: {},
              },
            ],
          },
        };
      },
    };
    const readyTool = createTool({
      name: "wait_for_process",
      description: "Wait for the process to start.",
      inputSchema: z.object({}),
      execute: async () => {
        await waitForPid(f.pidFile);
        return "running";
      },
    });
    const agent = new Agent({ id: "process-check", model, skills: f.skills, tools: [readyTool] });
    for (let index = 0; index < 3; index++) {
      await rm(f.pidFile, { force: true });
      const controller = new AbortController();
      const result = agent
        .generate({ prompt: "run", abortSignal: controller.signal })
        .catch((error: unknown) => error);
      const pid = await waitForPid(f.pidFile);
      controller.abort();
      expect(await result).toMatchObject({ name: "AgentRunCancelledError" });
      for (let attempt = 0; alive(pid) && attempt < 250; attempt++) await delay(5);
      expect(alive(pid)).toBe(false);
      checkResources();
      await rm(f.pidFile, { force: true });
      const stream = agent.stream({ prompt: "run", toolConcurrency: 2 });
      for await (const event of stream) {
        if (event.type === "tool_result" && event.toolName === "wait_for_process") {
          expect(event.result).toBe("running");
          expect(alive(await waitForPid(f.pidFile))).toBe(true);
          break;
        }
      }
      const streamedPid = await waitForPid(f.pidFile);
      for (let attempt = 0; alive(streamedPid) && attempt < 250; attempt++) await delay(5);
      expect(alive(streamedPid)).toBe(false);
      checkResources();
    }
  });

  it("acknowledges consumer-close cancellation without later tool work or model calls", async () => {
    const checkResources = resources();
    const counts = { modelCalls: 0, failures: 0, finishes: 0, starts: 0, stops: 0, laterWork: 0 };
    let notifyStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const cooperative = createTool({
      name: "cooperative",
      description: "Wait for cancellation.",
      inputSchema: z.object({}),
      async execute(_args, context) {
        const signal = context.abortSignal;
        if (signal === undefined) throw new Error("Missing tool cancellation signal");
        counts.starts++;
        notifyStarted();
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            counts.stops++;
            reject(new Error("Cooperative tool stopped"));
          };
          release = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error("Fixture cleanup"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
        counts.laterWork++;
        return "late";
      },
    });
    const ready = createTool({
      name: "ready",
      description: "Wait for the cooperative tool.",
      inputSchema: z.object({}),
      async execute() {
        await started;
        return "running";
      },
    });
    const model: StreamingCompletionModel = {
      provider: "test",
      modelId: "consumer-close",
      capabilities: {
        streaming: true,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion() {
        throw new Error("Unexpected completion");
      },
      async *streamCompletion() {
        counts.modelCalls++;
        yield {
          type: "final",
          response: {
            choice: [
              { type: "tool-call", toolCallId: "cooperative", toolName: "cooperative", input: {} },
              { type: "tool-call", toolCallId: "ready", toolName: "ready", input: {} },
            ],
            usage: Usage.empty(),
            rawResponse: {},
            finishReason: "tool-calls",
          },
        };
      },
    };
    const agent = new Agent({
      id: "consumer-close",
      model,
      tools: [cooperative, ready],
      lifecycle: {
        onError() {
          counts.failures++;
        },
        onFinish() {
          counts.finishes++;
        },
      },
    });
    try {
      for await (const event of agent.stream({ prompt: "run", toolConcurrency: 2 })) {
        if (event.type === "tool_result" && event.toolName === "ready") {
          expect(event.result).toBe("running");
          break;
        }
      }
      await delay(5);
      expect(counts).toEqual({
        modelCalls: 1,
        failures: 1,
        finishes: 0,
        starts: 1,
        stops: 1,
        laterWork: 0,
      });
      checkResources();
    } finally {
      release?.();
    }
  });

  it("does not abort the signal or report failure after normal stream completion", async () => {
    const checkResources = resources();
    let signal: AbortSignal | undefined;
    const counts = { modelCalls: 0, failures: 0, finishes: 0 };
    const ordinary = createTool({
      name: "ordinary",
      description: "Return an ordinary result.",
      inputSchema: z.object({}),
      execute(_args, context) {
        signal = context.abortSignal;
        return "ok";
      },
    });
    const model: StreamingCompletionModel = {
      provider: "test",
      modelId: "normal-stream",
      capabilities: {
        streaming: true,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion() {
        throw new Error("Unexpected completion");
      },
      async *streamCompletion() {
        counts.modelCalls++;
        const response: CompletionResponse = {
          choice:
            counts.modelCalls === 1
              ? [{ type: "tool-call", toolCallId: "ordinary", toolName: "ordinary", input: {} }]
              : [{ type: "text", text: "done" }],
          usage: Usage.empty(),
          rawResponse: {},
          finishReason: counts.modelCalls === 1 ? "tool-calls" : "stop",
        };
        yield { type: "final", response };
      },
    };
    const agent = new Agent({
      id: "normal-stream",
      model,
      tools: [ordinary],
      lifecycle: {
        onError() {
          counts.failures++;
        },
        onFinish() {
          counts.finishes++;
        },
      },
    });
    let output: unknown;
    let toolOutput: unknown;
    for await (const event of agent.stream({ prompt: "run" })) {
      if (event.type === "response") output = event.output;
      if (event.type === "tool_result") toolOutput = event.result;
    }
    expect(output).toBe("done");
    expect(toolOutput).toBe("ok");
    expect(signal?.aborted).toBe(false);
    expect(counts).toEqual({ modelCalls: 2, failures: 0, finishes: 1 });
    checkResources();
  });
});
