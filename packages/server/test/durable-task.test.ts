import { afterEach, expect, it, vi } from "vitest";
import { DurableRuntime, defineGoal } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { DurableClient } from "@anvia/client/durable";
import { createDurableHandler, type DurableAuthorization } from "../src/durable";
import { makeAgent, done } from "../../durable/test/helpers.js";
const runtimes: DurableRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});
import { waiting, parent } from "../../durable/test/task-fixtures.js";
function clientFor(
  runtime: DurableRuntime,
  authorize: (request: Request, resource: DurableAuthorization) => boolean,
) {
  const handler = createDurableHandler({ runtime, authorize });
  return {
    handler,
    client: new DurableClient({
      endpoint: "https://test/durable",
      fetch: async (url, init) => handler(new Request(url, init)),
    }),
  };
}
it("submits a goal with a dynamically registered agent through the task client", async () => {
  const assessedAgents: string[] = [];
  const goal = defineGoal({
    name: "per-submission-goal",
    version: 1,
    assess: async ({ agentId, previous }) => {
      assessedAgents.push(agentId);
      return {
        status: previous === null ? "continue" : "complete",
        progressKey: previous === null ? "one" : "two",
        summary: "Verified",
        next: "Continue",
        evidence: ["checked"],
      };
    },
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [goal],
  });
  runtimes.push(runtime);
  const { client } = clientFor(runtime, (_, resource) => resource.sessionId === "allowed");
  const submission = {
    name: goal.name,
    version: goal.version,
    sessionId: "allowed",
    requestId: "goal",
    input: {
      objective: "Build search",
      acceptanceCriteria: ["Tests pass"],
      limits: { maxSessions: 3, maxTotalModelTurns: 4, maxConsecutiveNoProgressSessions: 2 },
    },
  };
  await expect(client.submitTask(submission)).rejects.toMatchObject({ status: 400 });
  const bound = { ...submission, input: { ...submission.input, agentId: "researcher" } };
  await expect(client.submitTask(bound)).rejects.toMatchObject({ status: 404 });
  runtime.registerAgents([{ agent: makeAgent(async () => done()), version: "1" }]);
  const snapshot = await client.submitTask(bound);
  expect((await client.submitTask(bound)).task.id).toBe(snapshot.task.id);
  expect(await (await runtime.getTask(snapshot.task.id)).result()).toMatchObject({ sessions: 2 });
  expect(assessedAgents).toEqual(["researcher", "researcher"]);
});

it("submits, lists, graphs, signals and reconnects custom tasks over HTTP", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [waiting],
  });
  runtimes.push(runtime);
  const authorize = vi.fn((_request, resource) => resource.sessionId === "allowed");
  const { client, handler } = clientFor(runtime, authorize);
  const input = { name: "wait", version: 1, sessionId: "allowed", requestId: "1", input: null };
  await expect(client.submitTask({ ...input, input: "invalid" })).rejects.toMatchObject({
    status: 400,
  });
  await expect(client.submitTask({ ...input, version: 99 })).rejects.toMatchObject({ status: 409 });
  expect(runtime.health().ready).toBe(true);
  const snapshot = await client.submitTask(input);
  const id = snapshot.task.id;
  expect((await client.submitTask(input)).task.id).toBe(id);
  expect((await client.listTasks({ sessionId: "allowed" })).tasks[0]!.id).toBe(id);
  expect((await client.taskGraph(id)).rootId).toBe(id);
  await client.signalTask(id, "go", "signal", true);
  expect(await (await runtime.getTask(id)).result()).toBe("done");
  const events = [];
  for await (const event of client.streamTask(id, { after: snapshot.cursor })) events.push(event);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.rootId === id && event.sequence > snapshot.cursor)).toBe(
    true,
  );
  expect((await client.taskSnapshot(id)).task.status).toBe("completed");
  await expect(client.submitTask({ ...input, sessionId: "private" })).rejects.toMatchObject({
    status: 403,
  });
  await expect(client.listTasks({ sessionId: "private" })).rejects.toMatchObject({ status: 403 });
  expect((await handler(new Request("https://test/durable/tasks"))).status).toBe(400);
  await expect(
    client.streamTask(id, { after: 999999 })[Symbol.asyncIterator]().next(),
  ).rejects.toMatchObject({ status: 400 });
});
it("authorizes owned agent runs through the parent session and denies private tree controls", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [parent],
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(parent, {
    sessionId: "allowed",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.graph()).nodes).toHaveLength(2));
  const owned = (await task.graph()).nodes.find((node) => node.agentRunId !== undefined)!;
  const authorize = vi.fn((_request, resource) => resource.sessionId === "allowed");
  const { client } = clientFor(runtime, authorize);
  expect((await client.snapshot(owned.agentRunId!)).run.id).toBe(owned.agentRunId);
  expect(authorize).toHaveBeenCalledWith(
    expect.any(Request),
    expect.objectContaining({
      sessionId: "allowed",
      rootTaskId: task.id,
      taskId: owned.id,
      agentId: "researcher",
    }),
  );
  const denied = clientFor(runtime, (_request, resource) => resource.agentId === undefined).client;
  await expect(denied.taskGraph(task.id)).rejects.toMatchObject({ status: 403 });
  await expect(denied.cancelTask(task.id)).rejects.toMatchObject({ status: 403 });
  await expect(denied.streamTask(task.id)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    status: 403,
  });
  await client.cancelTask(task.id);
  expect((await task.snapshot()).task.status).toBe("cancelled");
});
it("denies every private task read and mutation before consuming payloads", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [waiting],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(waiting, {
    sessionId: "private",
    requestId: "1",
    input: null,
  });
  const { client } = clientFor(runtime, () => false);
  for (const action of [
    () => client.taskSnapshot(task.id),
    () => client.taskGraph(task.id),
    () => client.signalTask(task.id, "go", "signal", true),
    () => client.resolveEffect(task.id, "key", null),
    () => client.retryTask(task.id),
    () => client.cancelTask(task.id),
  ])
    await expect(action()).rejects.toMatchObject({ status: 403 });
});

it("does not cancel children created while asynchronous authorization is pending", async () => {
  const { deferredParent } = await import("../../durable/test/task-fixtures.js");
  let release!: () => void;
  const definition = deferredParent(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [definition],
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "allowed",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.snapshot()).task.status).toBe("running"));
  let authorizations = 0;
  const handler = createDurableHandler({
    runtime,
    authorize: async (_request, resource) => {
      if (resource.action === "cancel" && ++authorizations === 2) {
        release();
        await vi.waitFor(async () => expect((await task.graph()).nodes).toHaveLength(2));
      }
      return resource.agentId === undefined;
    },
  });
  const response = await handler(
    new Request(`https://test/durable/tasks/${task.id}/cancel`, { method: "POST" }),
  );
  expect(response.status).toBe(409);
  expect((await task.snapshot()).task.status).toBe("waiting");
  expect(
    (await task.graph()).nodes.every(
      (node) => node.status !== "cancelled" && node.status !== "cancelling",
    ),
  ).toBe(true);
  const retry = await handler(
    new Request(`https://test/durable/tasks/${task.id}/cancel`, { method: "POST" }),
  );
  expect(retry.status).toBe(403);
});

it("reauthorizes children created after an event subscription before exposing their events", async () => {
  const { deferredParent } = await import("../../durable/test/task-fixtures.js");
  let release!: () => void;
  const definition = deferredParent(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [definition],
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(definition, {
    sessionId: "allowed",
    requestId: "1",
    input: null,
  });
  const { client } = clientFor(runtime, (_request, resource) => resource.agentId === undefined);
  const iterator = client.streamTask(task.id)[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.taskId).toBe(task.id);
  release();
  const received: string[] = [];
  await expect(
    (async () => {
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        received.push(next.value.taskId);
      }
    })(),
  ).rejects.toThrow();
  expect(received.every((id) => id === task.id)).toBe(true);
});

it("applies owned-task authorization to run listing rows", async () => {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [parent],
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(runtime);
  const task = await runtime.submitTask(parent, {
    sessionId: "allowed",
    requestId: "1",
    input: null,
  });
  await vi.waitFor(async () => expect((await task.graph()).nodes).toHaveLength(2));
  const owned = (await task.graph()).nodes.find((node) => node.agentRunId !== undefined)!;
  const run = (await (await runtime.getRun(owned.agentRunId!)).snapshot()).run;
  const authorize = vi.fn((_request, resource) => resource.agentId === undefined);
  const { client } = clientFor(runtime, authorize);
  await expect(client.listRuns({ sessionId: run.sessionId })).rejects.toMatchObject({
    status: 403,
  });
  expect(authorize).toHaveBeenLastCalledWith(
    expect.any(Request),
    expect.objectContaining({
      action: "list",
      sessionId: "allowed",
      rootTaskId: task.id,
      taskId: owned.id,
      agentId: "researcher",
    }),
  );
});
