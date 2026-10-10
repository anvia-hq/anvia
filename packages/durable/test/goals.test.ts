import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import {
  DurableRuntime,
  defineGoal,
  type GoalDefinition,
  type GoalDecision,
  type GoalCheckpoint,
  type GoalResult,
  type DurableTaskHandle,
} from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, lookup, makeAgent, makeStreamingAgent, toolResponse } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});
const limits = { maxSessions: 5, maxTotalModelTurns: 10, maxConsecutiveNoProgressSessions: 2 };
const input = {
  sessionId: "project",
  requestId: "goal",
  objective: "Build search",
  acceptanceCriteria: ["Search tests pass"],
  limits,
};
const decision = (status: GoalDecision["status"], progressKey = "one"): GoalDecision => ({
  status,
  progressKey,
  summary: "Search index implemented",
  next: "Verify search",
  evidence: ["Index tests pass"],
});
async function open(
  goal: ReturnType<typeof defineGoal>,
  agent = makeAgent(async () => done()),
  stream = false,
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    tasks: [goal],
    agents: [
      {
        agent,
        version: "1",
        stream,
        toolRecovery: Object.fromEntries(agent.tools.map((tool) => [tool.name, "safe" as const])),
      },
    ],
    maxConcurrentTasks: 1,
    maxConcurrentRuns: 1,
  });
  runtimes.push(runtime);
  return runtime;
}
async function paused(
  handle: DurableTaskHandle<GoalResult>,
  reason: GoalCheckpoint["pauseReason"],
) {
  await expect
    .poll(async () => (await handle.snapshot()).task.checkpoint)
    .toMatchObject({ phase: "paused", pauseReason: reason });
  return (await handle.snapshot()).task;
}

it("continues bounded sessions, passes handoffs, and requires the assessor to accept completion", async () => {
  const prompts: string[] = [];
  const agent = makeAgent(async (request) => {
    prompts.push(JSON.stringify(request.chatHistory));
    return done(); // A model's final answer does not finish the goal.
  });
  const assess = vi.fn<GoalDefinition["assess"]>(async ({ previous }) =>
    decision(previous === null ? "continue" : "complete", previous === null ? "one" : "two"),
  );
  const goal = defineGoal({ name: "builder", version: 1, agentId: agent.id, assess });
  const runtime = await open(goal, agent);
  const handle = await runtime.submitGoal(goal, input);
  expect((await runtime.submitGoal(goal, input)).id).toBe(handle.id);
  expect(await handle.result()).toMatchObject({
    sessions: 2,
    modelTurns: 2,
    totalTokens: 6,
    handoff: { status: "complete" },
  });
  expect(assess).toHaveBeenCalledTimes(2);
  expect(prompts[1]).toContain("Index tests pass");
  expect(prompts[1]).toContain("Build search");
  expect((await handle.graph()).nodes).toHaveLength(3);
  await expect(runtime.submitGoal(goal, { ...input, objective: "Different" })).rejects.toThrow(
    "different submission",
  );
});

it("preserves exhausted tool results and caps a session by the goal's remaining model turns", async () => {
  let tools = 0;
  const tool = lookup(async () => {
    tools++;
    return "saved artifact";
  });
  const agent = new Agent({
    id: "researcher",
    maxTurns: 500,
    tools: [tool],
    model: makeAgent(async () => toolResponse()).model,
  });
  const assess = vi.fn<GoalDefinition["assess"]>(async () => decision("continue"));
  const goal = defineGoal({ name: "bounded", version: 1, agentId: agent.id, assess });
  const runtime = await open(goal, agent);
  const handle = await runtime.submitGoal(goal, {
    ...input,
    limits: { ...limits, maxTotalModelTurns: 2 },
  });
  await paused(handle, "max_model_turns");
  expect(tools).toBe(2);
  expect(assess.mock.calls[0]![0]).toMatchObject({
    session: { status: "exhausted", modelTurns: 2 },
  });
  const runId = (await handle.graph()).nodes[1]!.agentRunId!;
  const run = (await (await runtime.getRun(runId)).snapshot()).run;
  expect(run.exhaustion?.messages.filter((message) => message.role === "tool")).toHaveLength(2);
  expect(run.modelTurns).toBe(2);
  expect(run.maxModelTurns).toBe(2);
});

it("rolls over core maxTurns exhaustion into another session when the goal still has budget", async () => {
  const agent = new Agent({
    id: "researcher",
    maxTurns: 0,
    model: makeAgent(async () => toolResponse()).model,
    tools: [lookup(async () => "artifact")],
  });
  const sessions: string[] = [];
  const goal = defineGoal({
    name: "exhausted",
    version: 1,
    agentId: agent.id,
    assess: async ({ session }) => {
      sessions.push(session.status);
      return decision(sessions.length === 2 ? "complete" : "continue", String(sessions.length));
    },
  });
  const runtime = await open(goal, agent);
  const handle = await runtime.submitGoal(goal, input);
  await expect.poll(async () => (await handle.snapshot()).task.status).toBe("completed");
  expect(await handle.result()).toMatchObject({ sessions: 2, modelTurns: 2 });
  expect(sessions).toEqual(["exhausted", "exhausted"]);
});

it("pauses stalled work and resumes only on an explicit signal without resetting totals", async () => {
  let complete = false;
  const goal = defineGoal({
    name: "stalled",
    version: 1,
    agentId: "researcher",
    assess: async () => decision(complete ? "complete" : "continue"),
  });
  const runtime = await open(goal);
  const handle = await runtime.submitGoal(goal, input);
  const task = await paused(handle, "no_progress");
  expect(task.checkpoint).toMatchObject({ sessions: 3, modelTurns: 3 });
  expect(runtime.health().activeTasks).toBe(0);
  complete = true;
  await handle.signal("resume:0", "resume-request", { feedback: "Dependency repaired" });
  await handle.signal("resume:0", "resume-request", { feedback: "Dependency repaired" });
  expect(await handle.result()).toMatchObject({ sessions: 4, modelTurns: 4 });
});

it.each(["max_sessions", "max_tokens", "deadline"] as const)(
  "enforces %s admission limits",
  async (reason) => {
    const goal = defineGoal({
      name: reason,
      version: 1,
      agentId: "researcher",
      assess: async () => decision("continue"),
    });
    const runtime = await open(goal);
    const bounded = {
      ...limits,
      ...(reason === "max_sessions" ? { maxSessions: 1 } : {}),
      ...(reason === "max_tokens" ? { maxTotalTokens: 1 } : {}),
      ...(reason === "deadline" ? { deadline: "2000-01-01T00:00:00.000Z" } : {}),
    };
    const handle = await runtime.submitGoal(goal, { ...input, limits: bounded });
    const task = await paused(handle, reason);
    expect(task.checkpoint).toMatchObject({ sessions: reason === "deadline" ? 0 : 1 });
  },
);

it("accepts an explicit budget extension and gives invalid signals a new delivery name", async () => {
  let complete = false;
  const goal = defineGoal({
    name: "extend",
    version: 1,
    agentId: "researcher",
    assess: async () => decision(complete ? "complete" : "continue"),
  });
  const runtime = await open(goal);
  const handle = await runtime.submitGoal(goal, {
    ...input,
    limits: { ...limits, maxTotalModelTurns: 1 },
  });
  await paused(handle, "max_model_turns");
  await handle.signal("resume:0", "bad", { limits: { maxTotalModelTurns: -1 } });
  await expect
    .poll(async () => (await handle.snapshot()).task.wait)
    .toEqual({ type: "signal", name: "resume:1" });
  complete = true;
  await handle.signal("resume:1", "extension", {
    feedback: "Continue with approved budget",
    limits,
  });
  expect(await handle.result()).toMatchObject({ sessions: 2, modelTurns: 2 });
});

it("keeps failed sessions separate from turn exhaustion and does not silently restart them", async () => {
  const assess = vi.fn<GoalDefinition["assess"]>(async () => decision("complete"));
  const goal = defineGoal({ name: "failed", version: 1, agentId: "researcher", assess });
  const runtime = await open(
    goal,
    makeAgent(async () => {
      throw new Error("provider unavailable");
    }),
  );
  const handle = await runtime.submitGoal(goal, input);
  expect((await paused(handle, "session_failed")).checkpoint).toMatchObject({
    sessions: 1,
    modelTurns: 1,
  });
  expect(assess).not.toHaveBeenCalled();
  await handle.cancel();
  await expect(handle.result()).rejects.toThrow("cancelled");
});

it("preserves approval waits and the cumulative budget across approval epochs", async () => {
  const tool = { ...lookup(async () => "approved artifact"), requiresApproval: true };
  const agent = new Agent({
    id: "researcher",
    maxTurns: 500,
    tools: [tool],
    model: makeAgent(async () => toolResponse()).model,
  });
  const assess = vi.fn<GoalDefinition["assess"]>(async () => decision("continue"));
  const goal = defineGoal({ name: "approvals", version: 1, agentId: agent.id, assess });
  const runtime = await open(goal, agent);
  const handle = await runtime.submitGoal(goal, {
    ...input,
    limits: { ...limits, maxTotalModelTurns: 1 },
  });
  await expect
    .poll(async () => (await handle.graph()).nodes[1]?.wait)
    .toMatchObject({ type: "agent", status: "waiting" });
  expect(assess).not.toHaveBeenCalled();
  const child = await runtime.getRun((await handle.graph()).nodes[1]!.agentRunId!);
  const outcome = (await child.snapshot()).run.outcome;
  if (outcome?.type !== "interaction") throw new Error("Expected approval");
  await child.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
  await paused(handle, "max_model_turns");
  expect((await child.snapshot()).run.modelTurns).toBe(1);
  expect(
    (await child.snapshot()).run.exhaustion?.messages.some((message) => message.role === "tool"),
  ).toBe(true);
});

it("rejects malformed assessor results and invalid goal limits at their boundaries", async () => {
  const goal = defineGoal({
    name: "invalid",
    version: 1,
    agentId: "researcher",
    assess: async () => ({ ...decision("complete"), progressKey: "" }),
  });
  const runtime = await open(goal);
  await expect(
    runtime.submitGoal(goal, { ...input, limits: { ...limits, maxSessions: 1000 } }),
  ).rejects.toThrow("Invalid task input");
  const handle = await runtime.submitGoal(goal, input);
  await expect.poll(async () => (await handle.snapshot()).task.status).toBe("needs_attention");
  expect((await handle.snapshot()).task.error).toContain("invalid decision");
});

it("retries a failed verifier against the same completed session without repeating the agent", async () => {
  let attempts = 0;
  const completion = vi.fn(async () => done());
  const goal = defineGoal({
    name: "verifier-retry",
    version: 1,
    agentId: "researcher",
    assess: async () => {
      if (++attempts === 1) throw new Error("Verification service unavailable");
      return decision("complete");
    },
  });
  const runtime = await open(goal, makeAgent(completion));
  const handle = await runtime.submitGoal(goal, input);
  await expect.poll(async () => (await handle.snapshot()).task.status).toBe("needs_attention");
  await expect.poll(() => runtime.health().activeTasks).toBe(0);
  await handle.retry();
  expect(await handle.result()).toMatchObject({ sessions: 1, modelTurns: 1 });
  expect(attempts).toBe(2);
  expect(completion).toHaveBeenCalledTimes(1);
});

it("fences a late assessment result when the goal is cancelled during verification", async () => {
  let started!: () => void;
  const assessing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const goal = defineGoal({
    name: "cancel-assessment",
    version: 1,
    agentId: "researcher",
    assess: async (_, signal) => {
      const aborted = new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      started();
      await aborted;
      return decision("complete");
    },
  });
  const runtime = await open(goal);
  const handle = await runtime.submitGoal(goal, input);
  await assessing;
  await handle.cancel();
  await expect(handle.result()).rejects.toThrow("cancelled");
  const snapshot = await handle.snapshot({ operations: true });
  expect(snapshot.operations[0]?.status).toBe("started");
  expect(snapshot.task.outcome?.status).toBe("cancelled");
  expect((await handle.graph()).nodes).toHaveLength(2);
});

it("retains partial tool messages when a streaming session exhausts its allowance", async () => {
  const tool = vi.fn(async () => "streamed artifact");
  const agent = makeStreamingAgent(
    async function* () {
      yield { type: "final", response: toolResponse() };
    },
    [lookup(tool)],
  );
  const goal = defineGoal({
    name: "stream-exhaustion",
    version: 1,
    agentId: agent.id,
    assess: async ({ session }) => {
      expect(session.status).toBe("exhausted");
      expect(session.messages.some((message) => message.role === "tool")).toBe(true);
      return decision("complete");
    },
  });
  const runtime = await open(goal, agent, true);
  const handle = await runtime.submitGoal(goal, {
    ...input,
    limits: { ...limits, maxTotalModelTurns: 1 },
  });
  expect(await handle.result()).toMatchObject({ sessions: 1, modelTurns: 1 });
  expect(tool).toHaveBeenCalledTimes(1);
});
