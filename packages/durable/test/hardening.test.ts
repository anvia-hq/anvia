import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { DurableRuntime, defineTask, DurableLimitError } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { backupSqlite, restoreSqlite } from "../src/maintenance.js";
import type { DurableTransaction } from "../src/types.js";
import { done, makeAgent, response } from "./helpers.js";
const runtimes: DurableRuntime[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const submission = { agentId: "researcher", sessionId: "s", requestId: "r", prompt: "hello" };
const waiting = defineTask({
  name: "waiting",
  version: 1,
  input: z.null(),
  checkpoint: z.null(),
  output: z.null(),
  initial: () => null,
  run: async (ctx) =>
    ctx.signalValue("go") === undefined
      ? { status: "waiting", checkpoint: null, wait: { type: "signal", name: "go" } }
      : { status: "completed", output: null },
});

it("poisons the runtime after a model checkpoint failure and recovers from the saved intent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "durable-fault-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite");
  class FailingStore extends SqliteDurableStore {
    override transaction<T>(callback: (tx: DurableTransaction) => T): T {
      return super.transaction((tx) =>
        callback({
          ...tx,
          putOperation(id, operation) {
            if (operation.kind === "model" && operation.status === "completed")
              throw new Error("simulated SQLITE_FULL");
            tx.putOperation(id, operation);
          },
        }),
      );
    }
  }
  const notified = vi.fn(() => {
    throw new Error("observer failed");
  });
  const model = vi.fn(async () => done());
  const runtime = await DurableRuntime.open({
    store: new FailingStore(path),
    agents: [{ agent: makeAgent(model), version: "1" }],
    onFatalError: notified,
  });
  runtimes.push(runtime);
  const run = await runtime.submit(submission);
  await vi.waitFor(() => expect(runtime.health().status).toBe("failed"));
  expect(notified).toHaveBeenCalledTimes(1);
  await expect(run.result()).rejects.toThrow("storage failed");
  await expect(runtime.submit({ ...submission, sessionId: "other" })).rejects.toThrow(
    "storage failed",
  );
  await runtime.close();
  expect(runtime.health().status).toBe("closed");
  const recovered = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent: makeAgent(model), version: "1" }],
  });
  runtimes.push(recovered);
  expect((await (await recovered.getRun(run.id)).snapshot()).run.status).toBe("running");
  await recovered.resume();
  expect(await (await recovered.getRun(run.id)).result()).toMatchObject({ output: "done" });
  expect(model).toHaveBeenCalledTimes(2);
});

it("keeps validation errors healthy and enforces atomic admission with deduplication", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [waiting],
    limits: { maxPendingTasks: 1 },
  });
  runtimes.push(runtime);
  await expect(runtime.listTasks({ limit: 0 })).rejects.toThrow();
  expect(() => runtime.graphEvents("graph", -1)).toThrow(TypeError);
  expect(() => runtime.events("run", Number.NaN)).toThrow(TypeError);
  const task = await runtime.submitTask(waiting, { sessionId: "s", requestId: "1", input: null });
  await expect(
    runtime.submitTask(waiting, { sessionId: "s", requestId: "2", input: null }),
  ).rejects.toBeInstanceOf(DurableLimitError);
  expect(
    (await runtime.submitTask(waiting, { sessionId: "s", requestId: "1", input: null })).id,
  ).toBe(task.id);
  expect(runtime.health().ready).toBe(true);
  await vi.waitFor(async () => expect((await task.snapshot()).task.status).toBe("waiting"));
  expect(runtime.metrics()).toMatchObject({ tasks: { waiting: 1 }, operations: 0 });
  await task.cancel();
  await runtime.submitTask(waiting, { sessionId: "s", requestId: "2", input: null });
});

it("blocks oversized effect output for reconciliation without rerunning the effect", async () => {
  const effect = vi.fn(async () => "x".repeat(200));
  const definition = defineTask({
    name: "size",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.string(),
    initial: () => null,
    run: async (ctx) => ({ status: "completed", output: await ctx.effect("write", null, effect) }),
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [definition],
    limits: { maxPayloadBytes: 100 },
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "s",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.snapshot()).task.status).toBe("needs_attention"));
  expect(runtime.health().ready).toBe(true);
  await task.resolveEffect("write", "receipt");
  expect(await task.result()).toBe("receipt");
  expect(effect).toHaveBeenCalledTimes(1);
});

it("backs up and restores task waits, identities, cursors, and committed effects without overwrites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "durable-backup-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite"),
    archive = join(dir, "backup.sqlite"),
    restored = join(dir, "restored.sqlite");
  const effect = vi.fn(async () => "receipt");
  const definition = defineTask({
    ...waiting,
    name: "backup",
    run: async (ctx: Parameters<typeof waiting.run>[0]) => {
      await ctx.effect("write", null, effect);
      return waiting.run(ctx);
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    tasks: [definition],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "s",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.snapshot()).task.status).toBe("waiting"));
  const snapshot = await task.snapshot();
  await expect(backupSqlite(path, archive)).rejects.toThrow("live owner");
  await runtime.close();
  await backupSqlite(path, archive);
  expect(() => new SqliteDurableStore(archive)).toThrow("Sealed");
  await expect(backupSqlite(path, archive)).rejects.toMatchObject({ code: "EEXIST" });
  await expect(backupSqlite(join(dir, "missing"), archive)).rejects.toThrow();
  expect(existsSync(join(dir, "missing"))).toBe(false);
  // A killed SQLite owner leaves a recoverable WAL that can overwrite a new main file.
  const crashed = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE stale(value TEXT); INSERT INTO stale VALUES ('stale')");
    process.kill(process.pid, "SIGKILL");
  `,
    restored,
  ]);
  expect(crashed.signal).toBe("SIGKILL");
  const staleWal = readFileSync(restored + "-wal");
  expect(staleWal.length).toBeGreaterThan(32);
  rmSync(restored);
  await expect(restoreSqlite(archive, restored)).rejects.toMatchObject({ code: "EEXIST" });
  await expect(backupSqlite(path, restored)).rejects.toMatchObject({ code: "EEXIST" });
  expect(readFileSync(restored + "-wal")).toEqual(staleWal);
  for (const suffix of ["-wal", "-shm"]) rmSync(restored + suffix, { force: true });
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    writeFileSync(restored + suffix, "stale SQLite sidecar");
    await expect(restoreSqlite(archive, restored)).rejects.toMatchObject({ code: "EEXIST" });
    expect(existsSync(restored)).toBe(false);
    expect(readFileSync(restored + suffix, "utf8")).toBe("stale SQLite sidecar");
    rmSync(restored + suffix);
  }
  await restoreSqlite(archive, restored);
  await expect(restoreSqlite(archive, restored)).rejects.toMatchObject({ code: "EEXIST" });
  const recovery = await DurableRuntime.open({
    store: new SqliteDurableStore(restored),
    tasks: [definition],
  });
  runtimes.push(recovery);
  expect(await (await recovery.getTask(task.id)).snapshot()).toEqual(snapshot);
  await recovery.resume();
  const handle = await recovery.getTask(task.id);
  await handle.signal("go", "signal", true);
  expect(await handle.result()).toBe(null);
  expect(effect).toHaveBeenCalledTimes(1);
});

it("drains bounded concurrent tasks while preserving all results", async () => {
  const definition = defineTask({
    name: "load",
    version: 1,
    input: z.number(),
    checkpoint: z.null(),
    output: z.number(),
    initial: () => null,
    run: async (ctx) => ({
      status: "completed",
      output: await ctx.effect("echo", ctx.input, async () => ctx.input, "safe"),
    }),
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [definition],
    maxConcurrentTasks: 8,
  });
  runtimes.push(runtime);
  const handles = await Promise.all(
    Array.from({ length: 200 }, (_, n) =>
      runtime.submitTask(definition, { sessionId: "load", requestId: String(n), input: n }),
    ),
  );
  expect(await Promise.all(handles.map((handle) => handle.result()))).toEqual(
    Array.from({ length: 200 }, (_, n) => n),
  );
  expect(runtime.metrics()).toMatchObject({ tasks: { completed: 200 }, operations: 200 });
  await runtime.close();
  expect(runtime.health()).toMatchObject({ status: "closed", activeRuns: 0, activeTasks: 0 });
}, 20_000);

it("resumes after raising an operation limit without repeating already committed effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "durable-capacity-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite");
  const first = vi.fn(async () => "first");
  const second = vi.fn(async () => "second");
  const definition = defineTask({
    name: "capacity",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.string(),
    initial: () => null,
    run: async (ctx) => {
      await ctx.effect("a", null, first);
      return { status: "completed", output: await ctx.effect("b", null, second) };
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    tasks: [definition],
    limits: { maxOperations: 1 },
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "s",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.snapshot()).task.status).toBe("needs_attention"));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  expect(runtime.health().ready).toBe(true);
  await runtime.close();
  const recovery = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    tasks: [definition],
    limits: { maxOperations: 2 },
  });
  runtimes.push(recovery);
  const resumed = await recovery.getTask(task.id);
  await resumed.retry();
  expect(await resumed.result()).toBe("second");
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it("propagates an owned agent failure without poisoning the runtime at a small payload quota", async () => {
  const definition = defineTask({
    name: "parent",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.null(),
    initial: () => null,
    run: async (ctx) => {
      const child = ctx.spawnAgent("agent", { agentId: "researcher", prompt: "hi" });
      return {
        status: "waiting",
        checkpoint: null,
        wait: { type: "children", ids: [child], policy: "allSettled" },
      };
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [definition],
    limits: { maxPayloadBytes: 1000 },
    agents: [
      {
        agent: makeAgent(async () => {
          throw new Error("x".repeat(2000));
        }),
        version: "1",
      },
    ],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "s",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () =>
    expect(
      (await task.graph()).nodes.some(
        (node) => node.agentRunId !== undefined && node.status === "failed",
      ),
    ).toBe(true),
  );
  expect(runtime.health().ready).toBe(true);
  await task.cancel();
});

it("finishes copying a committed owned-agent output after restart with lower quotas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "durable-owned-copy-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite");
  class FailingStore extends SqliteDurableStore {
    override transaction<T>(callback: (tx: DurableTransaction) => T): T {
      return super.transaction((tx) =>
        callback({
          ...tx,
          putTask(task) {
            if (task.agentRunId !== undefined && task.outcome?.status === "completed")
              throw new Error("crash before owned output copy");
            tx.putTask(task);
          },
        }),
      );
    }
  }
  const definition = defineTask({
    name: "owner",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.null(),
    initial: () => null,
    run: async (ctx) => {
      ctx.spawnAgent("agent", { agentId: "researcher", prompt: "hi" });
      return { status: "completed", output: null };
    },
  });
  const model = vi.fn(async () => response([{ type: "text", text: "x".repeat(2000) }]));
  const agents = [{ agent: makeAgent(model), version: "1" }];
  const runtime = await DurableRuntime.open({
    store: new FailingStore(path),
    agents,
    tasks: [definition],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "s",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(() => expect(runtime.health().status).toBe("failed"));
  await runtime.close();
  const recovery = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents,
    tasks: [definition],
    limits: { maxPayloadBytes: 1000 },
  });
  runtimes.push(recovery);
  await recovery.resume();
  expect(await (await recovery.getTask(task.id)).result()).toBe(null);
  expect(
    (await recovery.taskGraph(task.id)).nodes.find((node) => node.agentRunId !== undefined)
      ?.outcome,
  ).toEqual({ status: "completed", output: "x".repeat(2000) });
  expect(model).toHaveBeenCalledTimes(1);
  expect(recovery.health().ready).toBe(true);
});
