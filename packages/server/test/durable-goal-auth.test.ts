import { DurableClient } from "@anvia/client/durable";
import { DurableRuntime, defineGoal, defineTask } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createDurableHandler, type DurableHandlerOptions } from "../src/durable";
import { Agent, done, makeAgent } from "../../durable/test/helpers.js";
import { parent } from "../../durable/test/task-fixtures.js";

const runtimes: DurableRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});
const goalInput = {
  objective: "Build search",
  acceptanceCriteria: ["Tests pass"],
  limits: { maxSessions: 2, maxTotalModelTurns: 3, maxConsecutiveNoProgressSessions: 2 },
};
const submission = {
  name: "scoped-goal",
  version: 1,
  sessionId: "allowed-session",
  requestId: "request",
  input: goalInput,
};
const complete = async () => ({
  status: "complete" as const,
  progressKey: "done",
  summary: "Verified",
  next: "",
  evidence: ["checked"],
});
function clientFor(runtime: DurableRuntime, authorize: DurableHandlerOptions["authorize"]) {
  const handler = createDurableHandler({ runtime, authorize });
  return new DurableClient({
    endpoint: "https://test/durable",
    fetch: async (url, init) => handler(new Request(url, init)),
  });
}
function agents() {
  return ["allowed-agent", "private-agent"].map((id) => ({
    agent: new Agent({ id, model: makeAgent(async () => done()).model }),
    version: "1",
  }));
}

it.each(["override", "default"])(
  "authorizes the effective %s agent before creating goal work",
  async (binding) => {
    const goal = defineGoal({
      name: submission.name,
      version: 1,
      agentId: binding === "default" ? "private-agent" : "allowed-agent",
      assess: complete,
    });
    const store = new SqliteDurableStore(":memory:");
    const runtime = await DurableRuntime.open({ store, tasks: [goal], agents: agents() });
    runtimes.push(runtime);
    const authorize = vi.fn<DurableHandlerOptions["authorize"]>(
      async (_, resource) =>
        resource.sessionId === submission.sessionId && resource.agentId === "allowed-agent",
    );
    const client = clientFor(runtime, authorize);
    const denied = {
      ...submission,
      input: { ...goalInput, ...(binding === "override" ? { agentId: "private-agent" } : {}) },
    };
    expect(runtime.taskSubmissionScope(denied).agentIds).toEqual(["private-agent"]);
    await expect(client.submitTask(denied)).rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.any(Request), {
      action: "submit",
      sessionId: submission.sessionId,
      taskName: submission.name,
      agentId: "private-agent",
    });
    expect((await runtime.listTasks()).tasks).toHaveLength(0);
    expect(store.transaction((tx) => tx.cursor())).toBe(0);
    const accepted = await client.submitTask({
      ...submission,
      input: { ...goalInput, agentId: "allowed-agent" },
    });
    expect(await (await runtime.getTask(accepted.task.id)).result()).toMatchObject({ sessions: 1 });
  },
);

it("checks every declared task agent and rejects a binding change during authorization", async () => {
  const task = defineTask({
    ...parent,
    name: "multi-agent",
    run: async () => ({ status: "completed", output: null }),
  });
  task.registration.agentDependencies = () => ["private-agent", "allowed-agent", "allowed-agent"];
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [task],
    agents: agents(),
  });
  runtimes.push(runtime);
  const request = { ...submission, name: task.name, input: null };
  const authorize = vi.fn<DurableHandlerOptions["authorize"]>(
    async (_, resource) => resource.agentId === "allowed-agent",
  );
  await expect(clientFor(runtime, authorize).submitTask(request)).rejects.toMatchObject({
    status: 403,
  });
  expect(authorize.mock.calls.map(([, resource]) => resource.agentId)).toEqual([
    "allowed-agent",
    "private-agent",
  ]);
  expect((await runtime.listTasks()).tasks).toHaveLength(0);

  task.registration.agentDependencies = () => ["allowed-agent"];
  const racing = clientFor(runtime, async () => {
    await Promise.resolve();
    task.registration.agentDependencies = () => ["private-agent"];
    return true;
  });
  await expect(racing.submitTask(request)).rejects.toMatchObject({ status: 409 });
  expect((await runtime.listTasks()).tasks).toHaveLength(0);
});

it("fails closed when an older runtime cannot resolve task submission scopes", async () => {
  const goal = defineGoal({
    name: submission.name,
    version: 1,
    agentId: "allowed-agent",
    assess: complete,
  });
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [goal],
    agents: agents(),
  });
  runtimes.push(runtime);
  Object.defineProperty(runtime, "taskSubmissionScope", { value: undefined });
  const authorize = vi.fn(() => true);
  await expect(clientFor(runtime, authorize).submitTask(submission)).rejects.toMatchObject({
    status: 503,
  });
  expect(authorize).not.toHaveBeenCalled();
  expect((await runtime.listTasks()).tasks).toHaveLength(0);
});
