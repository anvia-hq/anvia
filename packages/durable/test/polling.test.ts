import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** A model call that never finishes unless the runtime aborts it. */
function blockingAgent(state: { started: number; aborted: boolean }) {
  return makeAgent(async (_request, signal) => {
    if (state.started++ > 0) return done();

    await new Promise<void>((_, reject) =>
      signal?.addEventListener("abort", () => {
        state.aborted = true;
        reject(signal.reason);
      }),
    );
    return done();
  });
}

async function open(
  pollIntervalMs: number | undefined,
  state: { started: number; aborted: boolean },
) {
  const directory = mkdtempSync(join(tmpdir(), "durable-polling-"));
  directories.push(directory);
  const store = new SqliteDurableStore(join(directory, "runs.sqlite"));
  const options: Parameters<typeof DurableRuntime.open>[0] = {
    store,
    agents: [{ agent: blockingAgent(state), version: "1" }],
  };

  if (pollIntervalMs !== undefined) options.pollIntervalMs = pollIntervalMs;

  const runtime = await DurableRuntime.open(options);
  runtimes.push(runtime);
  return { runtime, store };
}

/** Stands in for a writer in another process: it touches the store, never the runtime. */
async function cancelExternally(store: SqliteDurableStore, id: string) {
  await store.transaction(async (tx) => {
    const run = (await tx.getRun(id))!;
    run.status = "cancelled";
    run.error = "Durable run cancelled.";
    run.updatedAt = new Date().toISOString();
    await tx.putRun(run);
    await tx.appendEvent(id, "status", { status: "cancelled", error: run.error });
  });
}

const submission = { agentId: "researcher", sessionId: "s", prompt: "hi" };

describe("store polling", () => {
  it("aborts an active run another writer cancelled and starts the run queued behind it", async () => {
    const state = { started: 0, aborted: false };
    const { runtime, store } = await open(20, state);
    const first = await runtime.submit({ ...submission, requestId: "a" });
    const second = await runtime.submit({ ...submission, requestId: "b" }, { enqueue: true });
    await expect.poll(() => state.started).toBe(1);

    await cancelExternally(store, first.id);

    await expect.poll(() => state.aborted).toBe(true);
    expect(await second.result()).toMatchObject({ type: "response", output: "done" });
    expect((await runtime.status(first.id)).status).toBe("cancelled");
  });

  it("does not notice an external cancellation without polling", async () => {
    const state = { started: 0, aborted: false };
    const { runtime, store } = await open(undefined, state);
    const first = await runtime.submit({ ...submission, requestId: "a" });
    await expect.poll(() => state.started).toBe(1);

    await cancelExternally(store, first.id);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(state.aborted).toBe(false);
    await runtime.cancel(first.id);
    await expect.poll(() => state.aborted).toBe(true);
  });

  it("rejects an invalid interval before taking ownership", async () => {
    const directory = mkdtempSync(join(tmpdir(), "durable-polling-"));
    directories.push(directory);
    const path = join(directory, "runs.sqlite");
    for (const pollIntervalMs of [0, -1, 1.5, Number.NaN])
      await expect(
        DurableRuntime.open({ store: new SqliteDurableStore(path), pollIntervalMs }),
      ).rejects.toThrow(/pollIntervalMs/);
    const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path) });
    runtimes.push(runtime);
  });
});
