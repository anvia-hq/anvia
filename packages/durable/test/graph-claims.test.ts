import { afterEach, describe, expect, it } from "vitest";
import { DurableClient, DurableRuntime, DurableWorker } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { InMemoryMemoryStore } from "@anvia/core/memory";
import { Agent, capabilities, done } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

type Pool = ReturnType<typeof testPool>["pool"];
const store = (pool: Pool) => new PostgresDurableStore({ pool }, { schema: "create" });

function agent(id: string, prompts: string[] = [], gate?: Promise<void>) {
  return new Agent({
    id,
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: async (request, options) => {
        const last = request.chatHistory.at(-1);
        prompts.push(JSON.stringify(last?.content));
        if (gate !== undefined)
          await new Promise<void>((resolve, reject) => {
            void gate.then(resolve);
            options?.abortSignal?.addEventListener("abort", () =>
              reject(options.abortSignal!.reason),
            );
          });
        return done();
      },
    },
  });
}

async function worker(pool: Pool, agents: Agent[]) {
  const started = await DurableWorker.start({
    store: store(pool),
    agents: agents.map((value) => ({ agent: value, version: "1" })),
    pollIntervalMs: 20,
  });
  closers.push(() => started.close());
  return started;
}

async function client(pool: Pool) {
  const value = await DurableClient.connect({ store: store(pool) });
  closers.push(() => value.close());
  return value;
}

const diamond = {
  sessionId: "g",
  requestId: "r",
  tasks: [
    { id: "left", agentId: "a", prompt: "LEFT" },
    { id: "right", agentId: "b", prompt: "RIGHT" },
    { id: "join", agentId: "a", prompt: "JOIN", dependsOn: ["left", "right"] },
  ],
};

describe("graphs with claims", () => {
  it("runs a client-submitted graph across workers that register different agents", async () => {
    const { pool } = testPool();
    const seen: string[] = [];
    await worker(pool, [agent("a", seen)]);
    await worker(pool, [agent("b", seen)]);
    const graph = await (await client(pool)).submitGraph(diamond);

    for await (const event of graph.stream()) void event;
    const snapshot = await graph.snapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.nodes.map((node) => node.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    // The join task received its dependencies' outputs.
    expect(seen.at(-1)).toContain("Task dependency results");
  });

  it("is idempotent and rejects a different graph under the same request", async () => {
    const { pool } = testPool();
    const c = await client(pool);
    const first = await c.submitGraph(diamond);
    expect((await c.submitGraph(diamond)).id).toBe(first.id);
    await expect(
      c.submitGraph({ ...diamond, tasks: [{ id: "x", agentId: "a", prompt: "other" }] }),
    ).rejects.toThrow(/different submission/);
    expect((await c.listGraphs()).graphs.map((entry) => entry.id)).toContain(first.id);
  });

  it("leaves tasks waiting for an agent no worker registers", async () => {
    const { pool } = testPool();
    await worker(pool, [agent("a")]);
    const graph = await (await client(pool)).submitGraph(diamond);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const snapshot = await graph.snapshot();
    expect(snapshot.nodes.find((node) => node.id === "left")?.status).toBe("completed");
    expect(snapshot.nodes.find((node) => node.id === "right")?.status).toBe("queued");
    expect(snapshot.status).not.toBe("completed");
  });

  it("cancels a graph from a client and stops the worker's running task", async () => {
    const { pool } = testPool();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: string[] = [];
    await worker(pool, [agent("a", seen, gate), agent("b", seen, gate)]);
    const c = await client(pool);
    const graph = await c.submitGraph(diamond);
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await graph.cancel();
    await expect
      .poll(async () => (await graph.snapshot()).nodes.map((node) => node.status))
      .toEqual(["cancelled", "cancelled", "cancelled"]);
    release();
    expect((await graph.snapshot()).status).toBe("cancelled");
  });

  it("lets a shared worker submit a graph for agents it does not register", async () => {
    const { pool } = testPool();
    const submitter = await DurableRuntime.open({
      store: store(pool),
      agents: [{ agent: agent("a"), version: "1" }],
      worker: {},
      pollIntervalMs: 20,
    });
    closers.push(() => submitter.close());
    await worker(pool, [agent("b")]);
    const graph = await submitter.submitGraph(diamond);
    for await (const event of graph.stream()) void event;
    expect((await graph.snapshot()).status).toBe("completed");
  });

  it("fails a graph task whose agent records memory when a worker admits it", async () => {
    const { pool } = testPool();
    const remembering = new Agent({
      id: "a",
      memory: { store: new InMemoryMemoryStore(), savePolicy: "run" },
      model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
    } as ConstructorParameters<typeof Agent>[0]);
    const started = await DurableWorker.start({
      store: store(pool),
      agents: [{ agent: remembering, version: "1", memory: { mode: "recorded" } }],
      pollIntervalMs: 20,
    });
    closers.push(() => started.close());
    const graph = await (
      await client(pool)
    ).submitGraph({
      sessionId: "g",
      requestId: "m",
      tasks: [{ id: "only", agentId: "a", prompt: "hi" }],
    });
    await expect
      .poll(async () => (await graph.snapshot()).nodes[0]?.status, { timeout: 5000 })
      .toBe("failed");
    expect((await graph.snapshot()).nodes[0]?.error).toMatch(/records memory/);
  });
});
