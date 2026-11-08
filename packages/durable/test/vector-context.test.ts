import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent, createVectorContext } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { VectorStore } from "@anvia/core/vector-store";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, hasToolResult, lookup, toolResponse } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-vector-context-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const embedder = (modelId = "embed-1"): EmbeddingModel => ({
  provider: "test",
  modelId,
  dimensions: 2,
  embedTexts: async (texts) => texts.map((document) => ({ document, vector: [1, 0] })),
});

function storeWith(text: string) {
  const search = vi.fn(async () => [{ id: "doc-1", score: 1, document: text }]);
  const store = {
    ensure: async () => {},
    validate: async () => {},
    upsert: async () => {},
    search,
  } as unknown as VectorStore<string>;
  return { store, search };
}

function agentWith(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  store: VectorStore<string>,
  options: { topK?: number; modelId?: string; tools?: boolean } = {},
) {
  return new Agent({
    id: "researcher",
    tools: options.tools === true ? [lookup(async () => "result")] : [],
    context: [
      createVectorContext({
        store,
        model: embedder(options.modelId),
        topK: options.topK ?? 2,
      }),
    ],
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  });
}

function registration(agent: Agent, marker = true): DurableAgentRegistration {
  return marker ? { agent, version: "1", context: { mode: "recorded" } } : { agent, version: "1" };
}

async function open(path: string, agent: Agent) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [registration(agent)],
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

const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "one",
  prompt: "what is in the notes?",
};

it("rejects vector context without the marker, naming it", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = agentWith(async () => done(), storeWith("a").store);
  expect(() => runtime.registerAgents([registration(agent, false)])).toThrow(
    /vector context needs \{ context: \{ mode: "recorded" \} \}/,
  );
  expect(() =>
    runtime.registerAgents([
      { agent, version: "1", context: { mode: "live" } as unknown as { mode: "recorded" } },
    ]),
  ).toThrow(/unknown context mode/);
});

it("records the retrieved documents before the model call and reports the marker", async () => {
  const { store, search } = storeWith("the sky is blue");
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(database(), agentWith(model, store));
  expect(runtime.compatibility()[0]).toMatchObject({ recordedContext: true });
  const run = await runtime.submit(submission);
  await run.result();

  expect(search).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0]![0].documents)).toContain("the sky is blue");
  const operations = (await run.snapshot({ operations: true })).operations;
  expect(operations.find((operation) => operation.key === "0:context-docs:1:0")).toMatchObject({
    kind: "effect",
    status: "completed",
  });
  expect((await run.snapshot()).run.vectorContext?.hash).toMatch(/^[0-9a-f]{64}$/);
});

it("retrieves once per model call, not on replay of a completed turn", async () => {
  const path = database();
  const { store, search } = storeWith("v1 text");
  let calls = 0;
  const flaky = vi.fn(async (request: CompletionRequest) => {
    calls += 1;
    if (!hasToolResult(request)) return toolResponse();
    if (calls === 2) throw new Error("provider down");
    return done();
  });
  const first = await open(path, agentWith(flaky, store, { tools: true }));
  const submitted = await first.submit(submission);
  expect((await settled(submitted)).run.status).toBe("failed");
  expect(search).toHaveBeenCalledTimes(2);
  await first.close();

  // The store now answers differently; the retry must still show the recorded documents.
  const changed = storeWith("v2 text");
  const model = vi.fn(async (request: CompletionRequest) => {
    expect(JSON.stringify(request.documents)).toContain("v1 text");
    return done();
  });
  const restarted = await open(path, agentWith(model, changed.store, { tools: true }));
  const run = await restarted.getRun(submitted.id);
  await run.retry();
  await run.result();

  expect(changed.search).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
});

it("blocks a retry whose vector context settings changed under the same version", async () => {
  const path = database();
  const { store } = storeWith("v1 text");
  const failing = vi.fn(async (_request: CompletionRequest) => {
    throw new Error("provider down");
  });
  const first = await open(path, agentWith(failing, store));
  const submitted = await first.submit(submission);
  expect((await settled(submitted)).run.status).toBe("failed");
  const recorded = (await submitted.snapshot()).run.vectorContext!.hash;
  await first.close();

  for (const variant of [{ topK: 5 }, { modelId: "embed-2" }]) {
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const changed = storeWith("v1 text");
    const runtime = await open(path, agentWith(model, changed.store, variant));
    const blocked = await runtime.getRun(submitted.id);
    await blocked.retry();
    const snapshot = await settled(blocked);
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.run.error).toContain("Vector context changed");
    expect(snapshot.run.error).toContain(recorded.slice(0, 8));
    expect(model).not.toHaveBeenCalled();
    expect(changed.search).not.toHaveBeenCalled();
    await runtime.close();
  }

  // Restoring the original settings unblocks the same run.
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const restored = await open(path, agentWith(model, storeWith("v1 text").store));
  const run = await restored.getRun(submitted.id);
  await run.retry();
  await run.result();
  expect(model).toHaveBeenCalledTimes(1);
});

it("records nothing for an agent without vector context", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [
      {
        agent: new Agent({
          id: "researcher",
          model: {
            provider: "test",
            modelId: "test",
            capabilities,
            completion: async () => done(),
          },
        }),
        version: "1",
        context: { mode: "recorded" },
      },
    ],
  });
  runtimes.push(runtime);
  const run = await runtime.submit(submission);
  await run.result();
  expect((await run.snapshot()).run.vectorContext).toBeUndefined();
  expect((await run.snapshot({ operations: true })).operations.map((o) => o.key)).not.toContain(
    "0:context-docs:1:0",
  );
});
