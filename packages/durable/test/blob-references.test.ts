import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime, type DurableRunRecord } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, response, toolResponse } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-blobs-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, agent: ReturnType<typeof makeAgent>) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

/** Poll until the run settles. A non-terminal failure shows up as a timeout here. */
async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

/** Raw stored records, exactly as they lie in the journal (no hydration). */
function stored(database: string, sql: string): string[] {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => String((row as { record: string }).record));
  } finally {
    db.close();
  }
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const big = "result-".repeat(20_000); // 140 KB, over the 64 KiB inline threshold

it("stores an oversized tool result externally; the model still receives the full result", async () => {
  const path = database();
  const tool = vi.fn(async () => big);
  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : toolResponse(),
  );
  const runtime = await open(path, makeAgent(model, [lookup(tool)]));
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "look it up",
  });
  expect(await run.result()).toMatchObject({ type: "response", output: "done" });
  expect(tool).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(2);
  // The provider saw the full result, not a reference.
  const second = model.mock.calls[1]![0];
  expect(JSON.stringify(second.chatHistory)).toContain(big);
  await runtime.close();

  // The journal holds a bounded reference, with the payload in the blob table.
  const operations = stored(path, "SELECT record FROM anvia_durable_operations");
  const toolRecord = operations.find((record) => record.includes('"kind":"tool"'))!;
  expect(toolRecord).toContain("anvia:blob");
  expect(toolRecord).not.toContain(big.slice(0, 500));
  for (const record of stored(path, "SELECT record FROM anvia_durable_runs"))
    expect(record.length).toBeLessThan(10_000);
  const blobs = new DatabaseSync(path, { readOnly: true });
  try {
    expect(
      Number(blobs.prepare("SELECT COUNT(*) AS n FROM anvia_durable_blobs").get()!.n),
    ).toBeGreaterThan(0);
  } finally {
    blobs.close();
  }
});

it("restores an externalized tool result after a restart without re-running the tool", async () => {
  const path = database();
  const tool = vi.fn(async () => big);
  const failing = vi.fn(async (request: CompletionRequest) => {
    if (hasToolResult(request)) throw new Error("provider down");
    return toolResponse();
  });
  const first = await open(path, makeAgent(failing, [lookup(tool)]));
  const submitted = await first.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "look it up",
  });
  expect((await settled(submitted)).run.status).toBe("failed");
  expect(tool).toHaveBeenCalledTimes(1);
  await first.close();

  const restartedTool = vi.fn(async () => "must not run");
  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : toolResponse(),
  );
  const runtime = await open(path, makeAgent(model, [lookup(restartedTool)]));
  await runtime.resume();
  const run = await runtime.getRun(submitted.id);
  await run.retry();
  expect(await run.result()).toMatchObject({ type: "response", output: "done" });
  // The completed tool operation was restored from the blob, not re-executed, and the retried
  // model call received the full result content.
  expect(restartedTool).not.toHaveBeenCalled();
  const retried = model.mock.calls.at(-1)![0];
  expect(JSON.stringify(retried.chatHistory)).toContain(big);
});

it("hydrates externalized history for the next run of the session", async () => {
  const path = database();
  const tool = vi.fn(async () => big);
  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : toolResponse(),
  );
  const agent = makeAgent(model, [lookup(tool)]);
  const runtime = await open(path, agent);
  const first = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "look it up",
  });
  await first.result();
  const second = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "two",
    prompt: "again",
  });
  await second.result();
  // The continued session's model request carried the restored history.
  const last = model.mock.calls.at(-1)![0];
  expect(JSON.stringify(last.chatHistory)).toContain(big);
  await runtime.close();

  for (const record of stored(path, "SELECT record FROM anvia_durable_runs"))
    expect(record.length).toBeLessThan(10_000);
});

it("externalizes an oversized outcome and reads it back after a restart", async () => {
  const path = database();
  const runtime = await open(
    path,
    makeAgent(async () => response([{ type: "text", text: big }])),
  );
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "write a lot",
  });
  const outcome = await run.result();
  expect(outcome.text).toBe(big);
  await runtime.close();

  for (const record of stored(path, "SELECT record FROM anvia_durable_runs"))
    expect(record.length).toBeLessThan(10_000);

  // A fresh owner reads the full outcome back from the blob table.
  const reopened = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(reopened);
  const restored = await reopened.getRun(run.id);
  const snapshot = await restored.snapshot();
  expect((snapshot.run as DurableRunRecord).outcome?.text).toBe(big);
  expect(JSON.stringify(snapshot.run.outcome?.messages)).toContain(big);
});

it("opens a schema version 9 store, migrates it, and keeps its runs readable", async () => {
  const path = database();
  const runtime = await open(
    path,
    makeAgent(async () => done()),
  );
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "hello",
  });
  await run.result();
  await runtime.close();

  // Downgrade the marker and drop the blob table to look exactly like a version 9 store.
  const db = new DatabaseSync(path);
  db.exec("DROP TABLE anvia_durable_blobs");
  db.exec(
    "UPDATE anvia_durable_owner SET version = 9, token = NULL, pid = NULL, host = NULL WHERE singleton = 1",
  );
  db.close();

  const migrated = await open(
    path,
    makeAgent(async () => done()),
  );
  const previous = await migrated.getRun(run.id);
  expect((await previous.snapshot()).run.status).toBe("completed");
  const next = await migrated.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "two",
    prompt: "again",
  });
  expect(await next.result()).toMatchObject({ type: "response", output: "done" });
  await migrated.close();

  const verify = new DatabaseSync(path, { readOnly: true });
  try {
    expect(
      verify.prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1").get()!.version,
    ).toBe(11);
    expect(
      verify
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'anvia_durable_blobs'")
        .get()!.n,
    ).toBe(1);
  } finally {
    verify.close();
  }
});

it("round-trips blob values by content hash, writing each once", async () => {
  const store = new SqliteDurableStore(":memory:");
  store.acquire();
  try {
    store.transaction((tx) => {
      const value = { text: big };
      const hash = tx.putBlob(value);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(tx.putBlob(value)).toBe(hash);
      expect(tx.getBlob(hash)).toEqual(value);
    });
    expect(() => store.transaction((tx) => tx.getBlob("0".repeat(64)))).toThrow(
      "Missing durable blob content.",
    );
  } finally {
    store.close();
  }
});
