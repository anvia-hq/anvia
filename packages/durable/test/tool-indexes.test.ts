import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, ToolDefinition } from "@anvia/core/completion";
import type { AnyTool, ToolIndex } from "@anvia/core/tool";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, response } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-tool-index-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function recallDefinition(description = "Recall saved notes"): ToolDefinition {
  return { name: "recall", description, parameters: { type: "object", properties: {} } };
}

function recallTool(description?: string): AnyTool {
  return {
    name: "recall",
    definition: () => recallDefinition(description),
    call: async () => "notes",
  };
}

/** A tool index whose search is a spy: each call is one embedding search in a real index. */
function indexWith(description: string | undefined, search: ReturnType<typeof vi.fn>): ToolIndex {
  return {
    kind: "tool-index",
    tools: [recallTool(description)],
    topK: 1,
    search: search as ToolIndex["search"],
  };
}

function searchResults() {
  return vi.fn(async (_options: { query: string; abortSignal?: AbortSignal | undefined }) => [
    {
      id: "recall",
      score: 1,
      document: { toolName: "recall", definition: recallDefinition(), text: "recall" },
    },
  ]);
}

function indexedAgent(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  index: ToolIndex,
) {
  return new Agent({
    id: "researcher",
    tools: [index],
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  });
}

function registration(agent: Agent, marker = true): DurableAgentRegistration {
  return marker
    ? { agent, version: "1", toolIndexes: { mode: "recorded" } }
    : { agent, version: "1" };
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

const submission = { agentId: "researcher", sessionId: "session", requestId: "one" };

it("rejects tool indexes without the marker and names it", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = indexedAgent(async () => done(), indexWith(undefined, searchResults()));
  expect(() => runtime.registerAgents([registration(agent, false)])).toThrow(
    /tool indexes need \{ toolIndexes: \{ mode: "recorded" \} \}/,
  );
  expect(runtime.compatibility()).toEqual([]);
});

it("rejects an unknown toolIndexes mode", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = indexedAgent(async () => done(), indexWith(undefined, searchResults()));
  expect(() =>
    runtime.registerAgents([
      { agent, version: "1", toolIndexes: { mode: "live" } as unknown as { mode: "recorded" } },
    ]),
  ).toThrow(/unknown toolIndexes mode/);
});

// Registration matrix: the recorded marker admits tool indexes; an agent without indexes is
// unaffected by the marker.
it.each([
  ["an agent without tool indexes", false],
  ["an agent with tool indexes and the recorded marker", true],
])("accepts %s", async (_label, withIndex) => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const agent = withIndex
    ? indexedAgent(async () => done(), indexWith(undefined, searchResults()))
    : new Agent({
        id: "researcher",
        model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
      });
  runtime.registerAgents([registration(agent)]);
  expect(runtime.compatibility().map((entry) => entry.agentId)).toEqual(["researcher"]);
});

it("offers the recorded selection to the model and records it before the model call", async () => {
  const search = searchResults();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(database(), indexedAgent(model, indexWith(undefined, search)));
  const run = await runtime.submit({ ...submission, prompt: "what notes do I have?" });
  await run.result();

  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]![0]).toMatchObject({ query: "what notes do I have?" });
  expect(model.mock.calls[0]![0].tools?.map((tool) => tool.name)).toEqual(["recall"]);

  const operations = (await run.snapshot({ operations: true })).operations;
  const selection = operations.find((operation) => operation.key === "0:tools:1");
  expect(selection).toMatchObject({ kind: "effect", status: "completed" });
  // The model operation input carries the selected tool definitions.
  const modelOperation = operations.find((operation) => operation.key === "0:model:1");
  expect(JSON.stringify(modelOperation?.input)).toContain('"name":"recall"');
});

it("reuses the recorded selection after a restart instead of searching again", async () => {
  const path = database();
  const search = searchResults();
  const failing = vi.fn(async (_request: CompletionRequest) => {
    throw new Error("provider down");
  });
  const first = await open(path, indexedAgent(failing, indexWith(undefined, search)));
  const submitted = await first.submit({ ...submission, prompt: "what notes do I have?" });
  expect((await settled(submitted)).run.status).toBe("failed");
  expect(search).toHaveBeenCalledTimes(1);
  const firstTools = failing.mock.calls[0]![0].tools;
  await first.close();

  const model = vi.fn(async (_request: CompletionRequest) => done());
  const restarted = await open(path, indexedAgent(model, indexWith(undefined, search)));
  const run = await restarted.getRun(submitted.id);
  await run.retry();
  await run.result();

  expect(search).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0]![0].tools).toEqual(firstTools);
});

it("blocks a retry whose tool index changed under the same version", async () => {
  const path = database();
  const failing = vi.fn(async (_request: CompletionRequest) => {
    throw new Error("provider down");
  });
  const first = await open(
    path,
    indexedAgent(failing, indexWith("Recall saved notes", searchResults())),
  );
  const submitted = await first.submit({ ...submission, prompt: "what notes do I have?" });
  expect((await settled(submitted)).run.status).toBe("failed");
  const recorded = (await submitted.snapshot()).run.toolIndexes!.hash;
  await first.close();

  const search = searchResults();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const changed = await open(
    path,
    indexedAgent(model, indexWith("Recall every note ever saved", search)),
  );
  const blocked = await changed.getRun(submitted.id);
  await blocked.retry();
  const snapshot = await settled(blocked);
  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.error).toContain("Tool indexes changed");
  expect(snapshot.run.error).toContain(recorded.slice(0, 8));
  expect(model).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
  await changed.close();

  // Restoring the original index unblocks the same run.
  const restored = await open(
    path,
    indexedAgent(model, indexWith("Recall saved notes", searchResults())),
  );
  const run = await restored.getRun(submitted.id);
  await run.retry();
  await run.result();
  expect(model).toHaveBeenCalledTimes(1);
});

it("records no selection for an agent without tool indexes", async () => {
  const runtime = await open(
    database(),
    new Agent({
      id: "researcher",
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async () => response([{ type: "text", text: "ok" }]),
      },
    }),
  );
  const run = await runtime.submit({ ...submission, prompt: "hi" });
  await run.result();
  const operations = (await run.snapshot({ operations: true })).operations;
  expect(operations.some((operation) => operation.key.includes(":tools:"))).toBe(false);
});
