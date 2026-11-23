import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableClient as StoreClient, DurableWorker, type DurableTaskGraph } from "@anvia/durable";
import { PostgresDurableStore } from "@anvia/durable/postgres";
import { DurableClient as HttpClient } from "@anvia/client/durable";
import { createDurableHandler } from "../src/durable";
import { done, makeAgent } from "../../durable/test/helpers.js";
import { testPool } from "../../durable/test/helpers/postgres.js";

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

/** HTTP in front of a store-only client, with a separate worker process doing the execution. */
async function setup() {
  const { pool } = testPool();
  const store = () => new PostgresDurableStore({ pool }, { schema: "create" });
  const worker = await DurableWorker.start({
    store: store(),
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
    pollIntervalMs: 20,
  });
  closers.push(() => worker.close());
  const backend = await StoreClient.connect({ store: store() });
  closers.push(() => backend.close());
  const authorize = vi.fn((_request, resource) => resource.sessionId === "allowed");
  const handler = createDurableHandler({ runtime: backend, authorize });
  const client = new HttpClient({
    endpoint: "http://anvia.test/durable",
    fetch: async (url, init) => handler(new Request(url, init)),
  });
  return { client, handler, authorize, backend };
}

const submission = {
  agentId: "researcher",
  sessionId: "allowed",
  requestId: "one",
  prompt: "hello",
};

describe("durable HTTP routes over a store-only DurableClient", () => {
  it("submits over HTTP and a separate worker executes the run", async () => {
    const { client } = await setup();
    const accepted = await client.submit(submission);
    await vi.waitFor(async () =>
      expect((await client.snapshot(accepted.run.id)).run.status).toBe("completed"),
    );
    const events: string[] = [];
    for await (const event of client.stream(accepted.run.id)) events.push(event.type);
    expect(events).toContain("model_completed");
  });

  it("keeps authorization in front of runs the backend owns", async () => {
    const { client, handler } = await setup();
    const accepted = await client.submit(submission);
    const denied = await handler(
      new Request(`http://anvia.test/durable/runs?sessionId=other`, { method: "GET" }),
    );
    expect(denied.status).toBe(403);
    await expect(
      client.submit({ ...submission, sessionId: "other", requestId: "x" }),
    ).rejects.toThrow();
    expect(accepted.run.sessionId).toBe("allowed");
  });

  it("cancels a run over HTTP", async () => {
    const { client } = await setup();
    const accepted = await client.submit({ ...submission, requestId: "c" });
    await client.cancel(accepted.run.id);
    await vi.waitFor(async () =>
      expect(["cancelled", "completed"]).toContain(
        (await client.snapshot(accepted.run.id)).run.status,
      ),
    );
  });

  it("serves graphs and task reads, and refuses task submission it cannot authorize", async () => {
    const { handler, backend } = await setup();
    const graph: DurableTaskGraph = await backend.submitGraph({
      sessionId: "allowed",
      requestId: "g",
      tasks: [{ id: "only", agentId: "researcher", prompt: "hi" }],
    });
    const response = await handler(
      new Request(`http://anvia.test/durable/graphs/${graph.id}`, { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const tasks = await handler(
      new Request("http://anvia.test/durable/tasks?sessionId=allowed", { method: "GET" }),
    );
    expect(tasks.status).toBe(200);
    const submitted = await handler(
      new Request("http://anvia.test/durable/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "x",
          version: 1,
          sessionId: "allowed",
          requestId: "t",
          input: null,
        }),
      }),
    );
    expect(submitted.status).toBe(503);
  });
});
