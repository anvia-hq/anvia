import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { recoveryGoal } from "./goal-fixtures.js";

const children: ChildProcess[] = [];
const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it.each(
  ["spawn", "assessment", "rollover"].flatMap((boundary) =>
    ["default", "override", "legacy"].map((binding) => ({ boundary, binding })),
  ),
)(
  "recovers after SIGKILL at $boundary with $binding binding without duplicating committed work",
  async ({ boundary, binding }) => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-goal-crash-"));
    directories.push(directory);
    const database = join(directory, "goals.sqlite");
    const log = join(directory, "work.txt");
    const worker = fork(
      fileURLToPath(new URL("./fixtures/goal-worker.ts", import.meta.url)),
      [database, log, boundary, binding],
      {
        execArgv: ["--import", import.meta.resolve("tsx")],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(worker);
    let stderr = "";
    worker.stderr!.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const { id } = await new Promise<{ id: string }>((resolve, reject) => {
      worker.once("message", (message) => resolve(message as { id: string }));
      worker.once("exit", () => reject(new Error(`Worker exited before checkpoint: ${stderr}`)));
      worker.once("error", reject);
    });
    const exited = once(worker, "exit");
    worker.kill("SIGKILL");
    await exited;
    const agentId = binding === "override" ? "per-user" : "researcher";
    const { goal, registration } = recoveryGoal(log, agentId);
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(database),
      tasks: [goal],
      agents: [registration],
    });
    runtimes.push(runtime);
    const handle = await runtime.getTask(id);
    if (binding === "legacy") {
      const { task, operations } = await handle.snapshot();
      expect(task.input).not.toHaveProperty("agentId");
      expect(task.checkpoint).not.toHaveProperty("agentId");
      for (const operation of operations) expect(operation.input).not.toHaveProperty("agentId");
    }
    const before = (await handle.graph()).nodes.map((node) => node.id);
    await runtime.resume();
    expect(await handle.result()).toMatchObject({ sessions: 2, modelTurns: 4, totalTokens: 12 });
    const after = (await handle.graph()).nodes.map((node) => node.id);
    expect(after).toHaveLength(3);
    expect(after).toEqual(expect.arrayContaining(before));
    expect((await handle.snapshot()).task.checkpoint).toHaveProperty("agentId", agentId);
    for (const child of (await handle.graph()).nodes.filter((node) => node.agentRunId))
      expect((await (await runtime.getRun(child.agentRunId!)).snapshot()).run.agentId).toBe(
        agentId,
      );
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.filter((line) => line === "tool")).toHaveLength(2);
    expect(lines.filter((line) => line === "assess")).toHaveLength(2);
  },
  15_000,
);
