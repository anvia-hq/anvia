import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { DurableClient } from "@anvia/client/durable";
import { createDurableHandler } from "../src/durable";
import {
  done,
  capabilities,
  hasToolResult,
  lookup,
  makeAgent,
  makeStreamingAgent,
  toolResponse,
} from "../../durable/test/helpers.js";

const runtimes: DurableRuntime[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "allowed",
  requestId: "one",
  prompt: "hello",
};
async function setup(agent = makeAgent(async () => done()), stream = false) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent, version: "1", ...(stream ? { stream: true } : {}) }],
  });
  runtimes.push(runtime);
  const authorize = vi.fn((_request, resource) => resource.sessionId === "allowed");
  const handler = createDurableHandler({ runtime, authorize, maxBodyBytes: 1024 });
  const client = new DurableClient({
    endpoint: "http://anvia.test/durable",
    fetch: async (url, init) => handler(new Request(url, init)),
  });
  return { runtime, authorize, handler, client };
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe("durable HTTP bridge", () => {
  it("sends images through the public client and HTTP bridge into the model", async () => {
    const model = vi.fn<Parameters<typeof makeAgent>[0]>(async () => done());
    const agent = makeAgent(model, [], { ...capabilities, imageInput: true });
    const { client, runtime } = await setup(agent);
    const prompt = {
      role: "user",
      content: [
        { type: "text", text: "Describe this image" },
        { type: "image", image: { type: "data", data: "aW1hZ2U=" }, mediaType: "image/png" },
      ],
    } as const;
    const accepted = await client.submit({ ...submission, prompt });
    await (await runtime.getRun(accepted.run.id)).result();
    expect(model.mock.calls[0]![0].chatHistory).toContainEqual(prompt);
    expect((await client.snapshot(accepted.run.id)).run.prompt).toEqual(prompt);
    expect((await client.submit({ ...submission, prompt: structuredClone(prompt) })).run.id).toBe(
      accepted.run.id,
    );
  });

  it("submits, discovers, and reconnects from a snapshot cursor through the public client", async () => {
    const { client, runtime, handler } = await setup();
    const initial = await client.submit(submission);
    const duplicate = await client.submit(submission);
    expect(duplicate.run.id).toBe(initial.run.id);
    await (await runtime.getRun(initial.run.id)).result();
    const events = [];
    for await (const event of client.stream(initial.run.id, { after: initial.cursor }))
      events.push(event);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.sequence > initial.cursor)).toBe(true);
    expect((await client.snapshot(initial.run.id)).run.status).toBe("completed");
    expect(
      (await client.listRuns({ sessionId: "allowed", status: "completed" })).runs,
    ).toHaveLength(1);
    const response = await handler(
      new Request(`http://anvia.test/durable/runs/${initial.run.id}/events`, {
        headers: { "last-event-id": String(initial.cursor) },
      }),
    );
    const text = await response.text();
    expect(text).toContain(`id: ${events[0]!.sequence}\n`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(
      client.stream(initial.run.id, { after: 999999 })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires session authorization for every operation and scopes listings", async () => {
    const { client, runtime, handler, authorize } = await setup();
    await expect(client.submit({ ...submission, sessionId: "private" })).rejects.toMatchObject({
      status: 403,
    });
    expect((await runtime.listRuns()).runs).toEqual([]);
    const privateRun = await runtime.submit({ ...submission, sessionId: "private" });
    await privateRun.result();
    for (const action of [
      () => client.snapshot(privateRun.id),
      () => client.cancel(privateRun.id),
      () => client.steer(privateRun.id, { prompt: "change" }),
      () => client.retry(privateRun.id),
      () => client.respond(privateRun.id, "approval", { type: "tool-approval", approved: true }),
      () => client.resolveTool(privateRun.id, "operation", { type: "text", value: "ok" }),
    ]) {
      await expect(action()).rejects.toMatchObject({ status: 403 });
    }
    await expect(client.stream(privateRun.id)[Symbol.asyncIterator]().next()).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(client.listRuns({ sessionId: "private" })).rejects.toMatchObject({ status: 403 });
    expect((await handler(new Request("http://anvia.test/durable/runs"))).status).toBe(400);
    expect(authorize.mock.calls.length).toBeGreaterThan(7);
  });

  it("resumes approvals over HTTP and rejects conflicting duplicate responses", async () => {
    const tool = vi.fn(async () => "approved");
    const agent = makeAgent(
      async (request) => (hasToolResult(request) ? done() : toolResponse()),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const { client } = await setup(agent);
    const { run } = await client.submit(submission);
    await vi.waitFor(async () =>
      expect((await client.snapshot(run.id)).run.status).toBe("waiting"),
    );
    const snapshot = await client.snapshot(run.id);
    if (snapshot.run.outcome?.type !== "interaction") throw new Error("Missing approval");
    const interactionId = snapshot.run.outcome.interaction.id;
    await client.respond(run.id, interactionId, { type: "tool-approval", approved: true });
    await client.respond(run.id, interactionId, { type: "tool-approval", approved: true });
    await expect(
      client.respond(run.id, interactionId, { type: "tool-approval", approved: false }),
    ).rejects.toMatchObject({ status: 409 });
    for await (const _event of client.stream(run.id, { after: snapshot.cursor })) {
      /* consume committed progress */
    }
    expect((await client.snapshot(run.id)).run.status).toBe("completed");
    expect(tool).toHaveBeenCalledTimes(1);
  });

  it("detaches a cancelled response body even with a pending read without cancelling execution", async () => {
    const model = vi.fn(
      async (_request, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    );
    const { client, handler } = await setup(makeAgent(model));
    const initial = await client.submit(submission);
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    const snapshot = await client.snapshot(initial.run.id);
    const response = await handler(
      new Request(
        `http://anvia.test/durable/runs/${initial.run.id}/events?after=${snapshot.cursor}`,
      ),
    );
    const reader = response.body!.getReader();
    const pending = reader.read();
    await reader.cancel();
    expect((await pending).done).toBe(true);
    expect((await client.snapshot(initial.run.id)).run.status).toBe("running");
    await client.cancel(initial.run.id);
    expect((await client.snapshot(initial.run.id)).run.status).toBe("cancelled");
  });

  it("returns validation/conflict errors and hides internal failures", async () => {
    const { client, runtime, handler } = await setup();
    await client.submit(submission);
    await expect(client.submit({ ...submission, prompt: "changed" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(client.snapshot("missing")).rejects.toMatchObject({ status: 404 });
    await expect(client.submit({ ...submission, prompt: "x".repeat(2000) })).rejects.toMatchObject({
      status: 413,
    });
    const post = (body: string, contentType = "application/json") =>
      handler(
        new Request("http://anvia.test/durable/runs", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        }),
      );
    expect((await post("{}")).status).toBe(400);
    expect((await post("{broken")).status).toBe(400);
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect(
      (await handler(new Request("http://anvia.test/durable/runs?sessionId=allowed&limit=-1")))
        .status,
    ).toBe(400);
    const failure = createDurableHandler({
      runtime,
      authorize: () => {
        throw new Error("private-secret");
      },
    });
    const response = await failure(new Request("http://anvia.test/durable/runs?sessionId=allowed"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-secret");
  });
});

describe("durable graph HTTP bridge", () => {
  const definition = {
    sessionId: "allowed",
    requestId: "graph",
    tasks: [
      { id: "left", agentId: "researcher", prompt: "left" },
      { id: "right", agentId: "researcher", prompt: "right" },
      { id: "join", agentId: "researcher", prompt: "join", dependsOn: ["left", "right"] },
    ],
  };
  it("exposes topology, task events, and child inspection through the owning session", async () => {
    const { client, authorize } = await setup();
    const graph = await client.submitGraph(definition);
    expect(graph.edges).toEqual([
      { source: "left", target: "join" },
      { source: "right", target: "join" },
    ]);
    expect((await client.submitGraph(definition)).id).toBe(graph.id);
    for await (const event of client.streamGraph(graph.id, { after: graph.cursor })) {
      expect(event.graphId).toBe(graph.id);
      expect(["left", "right", "join"]).toContain(event.taskId);
    }
    expect((await client.graphSnapshot(graph.id)).status).toBe("completed");
    expect((await client.listGraphs({ sessionId: "allowed" })).graphs[0]?.id).toBe(graph.id);
    const child = await client.snapshot(graph.nodes[0]!.runId);
    expect(child.run.graphId).toBe(graph.id);
    expect(authorize).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        action: "inspect",
        sessionId: "allowed",
        graphId: graph.id,
        taskId: "left",
      }),
    );
    await expect(client.listGraphs({ sessionId: "private" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("authorizes every graph task before submission or graph-wide access", async () => {
    const agent = makeAgent(
      async () => toolResponse(),
      [{ ...lookup(async () => "ok"), requiresApproval: true }],
    );
    const { runtime, client } = await setup(agent);
    const restricted = createDurableHandler({
      runtime,
      authorize: (_request, resource) =>
        resource.sessionId === "allowed" && resource.taskId !== "right",
    });
    const restrictedClient = new DurableClient({
      endpoint: "http://anvia.test/durable",
      fetch: async (url, init) => restricted(new Request(url, init)),
    });
    await expect(restrictedClient.submitGraph(definition)).rejects.toMatchObject({ status: 403 });
    expect((await runtime.listGraphs()).graphs).toEqual([]);
    expect((await runtime.listRuns()).runs).toEqual([]);
    const graph = await client.submitGraph(definition);
    await vi.waitFor(async () =>
      expect((await client.graphSnapshot(graph.id)).status).toBe("waiting"),
    );
    await expect(restrictedClient.graphSnapshot(graph.id)).rejects.toMatchObject({ status: 403 });
    await expect(restrictedClient.cancelGraph(graph.id)).rejects.toMatchObject({ status: 403 });
    await expect(
      restrictedClient.streamGraph(graph.id)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ status: 403 });
    expect((await restrictedClient.snapshot(graph.nodes[0]!.runId)).run.taskId).toBe("left");
    await expect(restrictedClient.snapshot(graph.nodes[1]!.runId)).rejects.toMatchObject({
      status: 403,
    });
    await client.cancelGraph(graph.id);
    expect((await client.graphSnapshot(graph.id)).status).toBe("cancelled");
    await expect(client.retry(graph.nodes[0]!.runId)).rejects.toMatchObject({ status: 409 });
  });
});

it("delivers persisted token events and reconnects by cursor over the durable HTTP bridge", async () => {
  const agent = makeStreamingAgent(async function* () {
    yield { type: "text_delta", delta: "do" };
    yield { type: "text_delta", delta: "ne" };
    yield { type: "final", response: done() };
  });
  const completion = vi.spyOn(agent.model, "completion");
  const { client, runtime } = await setup(agent, true);
  const initial = await client.submit(submission);
  await (await runtime.getRun(initial.run.id)).result();
  const saved = [];
  for await (const event of client.stream(initial.run.id)) saved.push(event);
  const deltas = saved.filter((event) => event.type === "model_delta");
  expect(deltas).toMatchObject([
    { data: { event: { type: "text_delta", delta: "do", turn: 1 } } },
    { data: { event: { type: "text_delta", delta: "ne", turn: 1 } } },
  ]);
  const reconnected = [];
  for await (const event of client.stream(initial.run.id, { after: deltas[0]!.sequence }))
    reconnected.push(event);
  expect(reconnected.filter((event) => event.type === "model_delta")).toEqual([deltas[1]]);
  expect((await client.snapshot(initial.run.id)).run.stream).toBe(true);
  expect(completion).not.toHaveBeenCalled();
});

it("steers remotely with authorization, deduplication, validation, and persisted events", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = vi.fn<Parameters<typeof makeAgent>[0]>(async () => {
    await held;
    return done();
  });
  const { client, runtime, authorize } = await setup(makeAgent(model));
  const { run } = await client.submit(submission);
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  try {
    const receipt = await client.steer(
      run.id,
      { prompt: "Use the new plan" },
      { requestId: "correction" },
    );
    expect(
      await client.steer(run.id, { prompt: "Use the new plan" }, { requestId: "correction" }),
    ).toEqual(receipt);
    await expect(
      client.steer(run.id, { prompt: "Conflict" }, { requestId: "correction" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(client.steer(run.id, { messages: [] })).rejects.toMatchObject({ status: 400 });
    await expect(client.steer(run.id, { prompt: "x".repeat(2000) })).rejects.toMatchObject({
      status: 413,
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ action: "steer", runId: run.id, sessionId: "allowed" }),
    );
  } finally {
    release();
  }
  await (await runtime.getRun(run.id)).result();
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1]![0].chatHistory.at(-1)).toEqual({
    role: "user",
    content: "Use the new plan",
  });
  const applied = [];
  for await (const event of client.stream(run.id))
    if (event.type === "steering_applied") applied.push(event);
  expect(applied).toHaveLength(1);
  await expect(client.steer(run.id, { prompt: "too late" })).rejects.toMatchObject({ status: 409 });
});
