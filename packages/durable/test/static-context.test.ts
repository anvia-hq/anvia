import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, Document } from "@anvia/core/completion";
import { DurableRuntime } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-context-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

function contextAgent(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  documents: readonly Document[],
) {
  return new Agent({
    id: "researcher",
    context: documents,
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  });
}

async function open(path: string, agent: Agent) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const submission = { agentId: "researcher", sessionId: "session", requestId: "one" };

it("runs with a static document and persists it with the run", async () => {
  const documents = [{ id: "doc-1", text: "The sky is green.", additionalProps: { a: "b" } }];
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(database(), contextAgent(model, documents));
  const run = await runtime.submit({ ...submission, prompt: "what color is the sky?" });
  await run.result();
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0]![0].documents).toEqual(documents);
  const snapshot = await run.snapshot();
  expect(snapshot.run.contextDocuments?.documents).toEqual(documents);
  expect(snapshot.run.contextDocuments?.hash).toMatch(/^[a-f0-9]{64}$/);
});

it("replays identical documents after a restart and retry", async () => {
  const path = database();
  const documents = [{ id: "doc-1", text: "The sky is green." }];
  const failing = vi.fn(async (_request: CompletionRequest) => {
    throw new Error("provider down");
  });
  const first = await open(path, contextAgent(failing, documents));
  const submitted = await first.submit({ ...submission, prompt: "what color is the sky?" });
  expect((await settled(submitted)).run.status).toBe("failed");
  await first.close();

  // A rebuilt registration with fresh but identical documents resumes the run.
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(path, contextAgent(model, [{ ...documents[0]! }]));
  const run = await runtime.getRun(submitted.id);
  await run.retry();
  await run.result();
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0]![0].documents).toEqual(documents);
});

it("blocks a retry whose registration documents changed under the same version", async () => {
  const path = database();
  const failing = vi.fn(async (_request: CompletionRequest) => {
    throw new Error("provider down");
  });
  const first = await open(path, contextAgent(failing, [{ id: "doc-1", text: "version one" }]));
  const submitted = await first.submit({ ...submission, prompt: "summarize" });
  expect((await settled(submitted)).run.status).toBe("failed");
  const recorded = (await submitted.snapshot()).run.contextDocuments!.hash;
  await first.close();

  const model = vi.fn(async (_request: CompletionRequest) => done());
  const changed = await open(path, contextAgent(model, [{ id: "doc-1", text: "version two" }]));
  const blocked = await changed.getRun(submitted.id);
  await blocked.retry();
  const snapshot = await settled(blocked);
  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.error).toContain("Context documents changed");
  expect(snapshot.run.error).toContain(recorded.slice(0, 8));
  expect(model).not.toHaveBeenCalled();
  await changed.close();

  // Restoring the original documents unblocks the same run.
  const restored = await open(path, contextAgent(model, [{ id: "doc-1", text: "version one" }]));
  const run = await restored.getRun(submitted.id);
  await run.retry();
  await run.result();
  expect(model).toHaveBeenCalledTimes(1);
});

itSqlite(
  "stores a large document set as a blob reference and hydrates it for readers",
  async () => {
    const path = database();
    const big = "fact-".repeat(30_000); // 150 KB, over the 64 KiB inline threshold
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(path, contextAgent(model, [{ id: "big", text: big }]));
    const run = await runtime.submit({ ...submission, prompt: "summarize" });
    await run.result();
    // The model received the full document text.
    expect(model.mock.calls[0]![0].documents?.[0]?.text).toBe(big);
    const snapshot = await run.snapshot();
    expect(snapshot.run.contextDocuments?.documents).toEqual([{ id: "big", text: big }]);
    await runtime.close();

    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const record = String(db.prepare("SELECT record FROM anvia_durable_runs").get()!.record);
      expect(record).toContain("anvia:blob");
      expect(record.length).toBeLessThan(10_000);
    } finally {
      db.close();
    }
  },
);
