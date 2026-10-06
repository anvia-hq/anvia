import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { DurableRuntime, defineTask } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";

const children: ChildProcess[] = [];
const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it.each(["committed", "manual", "idempotent"] as const)(
  "recovers %s task effects and stable child identities after SIGKILL",
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-task-crash-"));
    directories.push(directory);
    const database = join(directory, "tasks.sqlite");
    const effects = join(directory, "effects.txt");
    const worker = fork(
      fileURLToPath(new URL("./fixtures/task-worker.ts", import.meta.url)),
      [database, effects, mode],
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
    let effectCalls = 0;
    const child = defineTask({
      name: "child",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.null(),
      initial: () => null,
      run: async () => {
        appendFileSync(effects, "child\n");
        return { status: "completed", output: null };
      },
    });
    const parent = defineTask({
      name: "parent",
      version: 1,
      input: z.null(),
      checkpoint: z.null(),
      output: z.string(),
      initial: () => null,
      run: async (ctx) => {
        ctx.spawn("child", child, null);
        const output = await ctx.effect(
          "external",
          { amount: 1 },
          async (operationId) => {
            effectCalls++;
            if (!readFileSync(effects, "utf8").includes(operationId))
              appendFileSync(effects, `${operationId}\n`);
            return "receipt";
          },
          mode === "idempotent" ? "idempotent" : "manual",
        );
        return { status: "completed", output };
      },
    });
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(database),
      tasks: [parent, child],
    });
    runtimes.push(runtime);
    await runtime.resume();
    const handle = await runtime.getTask(id);
    if (mode === "manual") {
      await expect.poll(async () => (await handle.snapshot()).task.status).toBe("needs_attention");
      await handle.resolveEffect("external", "receipt");
    }
    expect(await handle.result()).toBe("receipt");
    expect(effectCalls).toBe(mode === "idempotent" ? 1 : 0);
    const lines = readFileSync(effects, "utf8").trim().split("\n");
    expect(lines.filter((line) => line !== "child")).toEqual([`${id}/external`]);
    expect(lines.filter((line) => line === "child")).toHaveLength(1);
    expect((await handle.graph()).nodes).toHaveLength(2);
  },
  15000,
);
