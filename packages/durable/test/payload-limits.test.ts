import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableLimitError, DurableRunError, DurableRuntime } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "session",
  prompt: "hello",
};

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-limits-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, maxPayloadBytes: number, agent = makeAgent(async () => done())) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
    limits: { maxPayloadBytes },
  });
  runtimes.push(runtime);
  return runtime;
}

/** Poll until the run settles. A non-terminal limit failure shows up as a timeout here. */
async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

async function terminalEvents(run: DurableRun) {
  const events = [];
  for await (const event of run.stream()) events.push(event);
  return events;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("fails terminally when inherited history exceeds the payload limit", async () => {
  const path = database();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const agent = makeAgent(model);
  const roomy = await open(path, 64 * 1024, agent);
  for (const turn of [1, 2, 3]) {
    const run = await roomy.submit({
      ...submission,
      requestId: `turn-${turn}`,
      prompt: "x".repeat(1_500) + turn,
    });
    await run.result();
  }
  expect(model).toHaveBeenCalledTimes(3);
  await roomy.close();

  // The session history now fits the old limit but not the new one.
  const constrained = await open(path, 2_000, agent);
  const blocked = await constrained.submit({ ...submission, requestId: "turn-4", prompt: "next" });
  const snapshot = await settled(blocked);
  expect(snapshot.run.status).toBe("failed");
  // The admission transaction rolled back, so the run never committed the history it could not fit.
  expect(snapshot.run.history).toEqual([]);
  expect(snapshot.run.error).toMatch(/payload byte limit exceeded/);
  expect(snapshot.run.error).toMatch(/run\.(input|history)/);
  await expect(blocked.result()).rejects.toBeInstanceOf(DurableRunError);
  await expect(blocked.result()).rejects.toMatchObject({ status: "failed" });
  const events = await terminalEvents(blocked);
  expect(events.at(-1)).toMatchObject({
    type: "status",
    data: expect.objectContaining({ status: "failed" }),
  });
  expect(events.map((event) => (event.data as { status?: string }).status)).not.toContain(
    "needs_attention",
  );
  expect(model).toHaveBeenCalledTimes(3);

  // Retrying cannot fit the same history, so it fails with the same typed error and stays failed.
  await expect(blocked.retry()).rejects.toBeInstanceOf(DurableLimitError);
  await expect(blocked.retry()).rejects.toThrow(/run\.(input|history)/);
  expect((await blocked.snapshot()).run.status).toBe("failed");
  expect((await blocked.snapshot()).run.history).toEqual([]);
  expect(model).toHaveBeenCalledTimes(3);

  // Once the limit admits the inherited history, retry executes the whole conversation.
  await constrained.close();
  const raised = await open(path, 64 * 1024, agent);
  const retried = await raised.getRun(blocked.id);
  await retried.retry();
  await expect(retried.result()).resolves.toMatchObject({ type: "response", output: "done" });
  expect(model).toHaveBeenCalledTimes(4);
  expect((await retried.snapshot()).run.history).toHaveLength(6);
  const request = model.mock.calls[3]![0];
  expect(request.chatHistory.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
  ]);
  expect(JSON.stringify(request.chatHistory)).toContain("x".repeat(1_500) + 1);
  expect(JSON.stringify(request.chatHistory)).toContain("next");
});

it("never parks a session that grows past the payload limit in needs_attention", async () => {
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(":memory:", 2_000, makeAgent(model));
  let blocked: DurableRun | undefined;
  for (let turn = 1; turn <= 8 && blocked === undefined; turn++) {
    const run = await runtime.submit({
      ...submission,
      requestId: `turn-${turn}`,
      prompt: "y".repeat(400) + turn,
    });
    const snapshot = await settled(run);
    expect(snapshot.run.status).not.toBe("needs_attention");
    if (snapshot.run.status === "completed") continue;
    blocked = run;
    await expect(run.result()).rejects.toMatchObject({ status: "failed" });
    await expect(terminalEvents(run)).resolves.toBeDefined();
  }
  expect(blocked).toBeDefined();
  expect(runtime.health().ready).toBe(true);
});
