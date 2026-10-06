import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { DurableRuntime, type ToolRecovery } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { ToolCallContext } from "@anvia/core/tool";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

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

async function crash(crashAt: "tool" | "model" | "budget", recovery: ToolRecovery = "manual") {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-crash-"));
  directories.push(directory);
  const database = join(directory, "runs.sqlite");
  const effects = join(directory, "effects.txt");
  const child = fork(
    fileURLToPath(new URL("./fixtures/crash-worker.ts", import.meta.url)),
    [database, effects, crashAt, recovery],
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
  const ready = new Promise<{ id: string }>((resolve, reject) => {
    child.once("message", (message) => resolve(message as { id: string }));
    child.once("exit", () => reject(new Error(`Worker exited before checkpoint: ${stderr}`)));
    child.once("error", reject);
  });
  const { id } = await ready;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  return { id, database, effects };
}

async function restart(database: string, effects: string, recovery: ToolRecovery = "manual") {
  const tool = vi.fn(async (_args: unknown, context?: ToolCallContext) => {
    const effect = recovery === "idempotent" ? `${context?.operationId}\n` : "effect\n";
    if (recovery !== "idempotent" || !readFileSync(effects, "utf8").includes(effect)) {
      appendFileSync(effects, effect);
    }
    return "stored result";
  });
  const model = vi.fn(async (request) => (hasToolResult(request) ? done() : toolResponse()));
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(database),
    agents: [
      { agent: makeAgent(model, [lookup(tool)]), version: "1", toolRecovery: { lookup: recovery } },
    ],
  });
  runtimes.push(runtime);
  await runtime.resume();
  return { runtime, model, tool };
}

it("recovers after SIGKILL without repeating a committed tool or model result", async () => {
  const { id, database, effects } = await crash("model");
  const { runtime, model, tool } = await restart(database, effects);
  const run = await runtime.getRun(id);
  expect(await run.result()).toMatchObject({ output: "done" });
  expect(tool).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
  expect(readFileSync(effects, "utf8")).toBe("effect\n");
}, 15000);

it("repeats only an interrupted operation explicitly declared safe", async () => {
  const { id, database, effects } = await crash("tool", "safe");
  const { runtime, tool } = await restart(database, effects, "safe");
  expect(await (await runtime.getRun(id)).result()).toMatchObject({ output: "done" });
  expect(tool).toHaveBeenCalledTimes(1);
  expect(readFileSync(effects, "utf8")).toBe("effect\neffect\n");
}, 15000);

it("blocks an uncertain tool after SIGKILL and resumes from an explicitly reconciled result", async () => {
  const { id, database, effects } = await crash("tool");
  // A new policy must not relax the policy recorded when this operation started.
  const { runtime, model, tool } = await restart(database, effects, "safe");
  const run = await runtime.getRun(id);
  await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("needs_attention"));
  expect(tool).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  const operationId = (await run.snapshot()).run.blockedOperation!;
  await run.resolveTool(operationId, { type: "text", value: "reconciled result" });
  expect(await run.result()).toMatchObject({ output: "done" });
  expect(readFileSync(effects, "utf8")).toBe("effect\n");
  expect(tool).not.toHaveBeenCalled();
}, 15000);

it("reuses the external idempotency key after SIGKILL", async () => {
  const { id, database, effects } = await crash("tool", "idempotent");
  const originalEffect = readFileSync(effects, "utf8");
  const { runtime, tool } = await restart(database, effects, "idempotent");
  expect(await (await runtime.getRun(id)).result()).toMatchObject({ output: "done" });
  expect(tool).toHaveBeenCalledTimes(1);
  expect(tool.mock.calls[0]?.[1]?.operationId).toBe(originalEffect.trim());
  expect(readFileSync(effects, "utf8")).toBe(originalEffect);
}, 15000);

it("counts a SIGKILL during the last model attempt and requires an explicit retry", async () => {
  const { id, database, effects } = await crash("budget");
  const { runtime, model, tool } = await restart(database, effects);
  const run = await runtime.getRun(id);
  await expect(run.result()).rejects.toThrow("attempt budget exhausted");
  expect(model).not.toHaveBeenCalled();
  expect(tool).not.toHaveBeenCalled();
  await run.retry();
  expect(await run.result()).toMatchObject({ output: "done" });
  expect(model).toHaveBeenCalledTimes(1);
  expect(tool).not.toHaveBeenCalled();
}, 15000);

it("restores a graph after SIGKILL without replaying a completed prerequisite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-graph-crash-"));
  directories.push(directory);
  const database = join(directory, "runs.sqlite");
  const child = fork(
    fileURLToPath(new URL("./fixtures/graph-worker.ts", import.meta.url)),
    [database],
    {
      execArgv: ["--import", import.meta.resolve("tsx")],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.push(child);
  const ready = await new Promise<{ id: string }>((resolve, reject) => {
    child.once("message", (value) => resolve(value as { id: string }));
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Graph worker exited before its checkpoint")));
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const model = vi.fn(async () => done());
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(database),
    agents: [{ agent: makeAgent(model), version: "1" }],
  });
  runtimes.push(runtime);
  const graph = await runtime.getGraph(ready.id);
  const before = await graph.snapshot();
  expect(before.nodes[0]?.status).toBe("completed");
  expect(before.nodes[1]?.status).toBe("running");
  await runtime.resume();
  for await (const event of graph.stream({ after: before.cursor }))
    expect(event.taskId).toBe("child");
  expect((await graph.snapshot()).status).toBe("completed");
  expect(model).toHaveBeenCalledTimes(1);
}, 15000);
