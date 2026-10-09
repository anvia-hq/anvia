import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@anvia/core/agent";
import { afterEach, expect, it, vi } from "vitest";
import {
  DurableRuntime,
  defineGoal,
  type GoalAssessment,
  type GoalDefinition,
  type GoalDecision,
} from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const input = {
  sessionId: "project",
  requestId: "goal",
  objective: "Build search",
  acceptanceCriteria: ["Search tests pass"],
  limits: { maxSessions: 5, maxTotalModelTurns: 10, maxConsecutiveNoProgressSessions: 2 },
};
const decision = (status: GoalDecision["status"]): GoalDecision => ({
  status,
  progressKey: status,
  summary: "Verified",
  next: "Continue",
  evidence: ["checked"],
});
const registration = (id: string, completion = vi.fn(async () => done())) => ({
  agent: new Agent({ id, model: makeAgent(completion).model }),
  version: "1",
});
async function open(goal: ReturnType<typeof defineGoal>, path = ":memory:") {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path), tasks: [goal] });
  runtimes.push(runtime);
  return runtime;
}

it("isolates per-submission agents across multiple sessions on one registered definition", async () => {
  const assessments: GoalAssessment[] = [];
  const goal = defineGoal({
    name: "shared",
    version: 1,
    agentId: "unused-default",
    assess: async (assessment) => {
      assessments.push(assessment);
      return decision(assessment.previous === null ? "continue" : "complete");
    },
  });
  const runtime = await open(goal);
  const alice = vi.fn(async () => done());
  const bob = vi.fn(async () => done());
  runtime.registerAgents([registration("alice", alice), registration("bob", bob)]);
  const handles = await Promise.all(
    ["alice", "bob"].map((agentId) =>
      runtime.submitGoal(goal, { ...input, requestId: agentId, agentId }),
    ),
  );
  for (const [index, handle] of handles.entries()) {
    const agentId = index === 0 ? "alice" : "bob";
    expect(await handle.result()).toMatchObject({ sessions: 2 });
    expect((await handle.snapshot()).task).toMatchObject({
      input: { agentId },
      checkpoint: { agentId },
    });
    for (const node of (await handle.graph()).nodes.filter((node) => node.agentRunId)) {
      expect((await (await runtime.getRun(node.agentRunId!)).snapshot()).run.agentId).toBe(agentId);
    }
    expect(assessments.filter((value) => value.agentId === agentId)).toHaveLength(2);
  }
  expect(alice).toHaveBeenCalledTimes(2);
  expect(bob).toHaveBeenCalledTimes(2);
  await expect(
    runtime.submitGoal(goal, { ...input, requestId: "alice", agentId: "bob" }),
  ).rejects.toThrow("different submission");
});

it.each(["goal", "registered"])(
  "validates agent bindings before persisting a %s submission",
  async (path) => {
    const assess = vi.fn<GoalDefinition["assess"]>(async () => decision("complete"));
    const goal = defineGoal({ name: "dynamic", version: 1, assess });
    const runtime = await open(goal);
    const submit = (agentId?: string) => {
      const goalInput = { ...input, ...(agentId === undefined ? {} : { agentId }) };
      if (path === "goal") return runtime.submitGoal(goal, goalInput);
      const { sessionId, requestId, ...value } = goalInput;
      return runtime.submitRegisteredTask({
        name: goal.name,
        version: goal.version,
        sessionId,
        requestId,
        input: value,
      });
    };
    await expect(submit()).rejects.toThrow("Goal agentId is required");
    await expect(submit("missing")).rejects.toThrow("Unknown durable agent: missing");
    await expect(submit("  ")).rejects.toThrow("Invalid task input");
    expect((await runtime.listTasks()).tasks).toHaveLength(0);
    expect(assess).not.toHaveBeenCalled();
    runtime.registerAgents([registration("captured")]);
    const handle = await submit("captured");
    expect(await handle.result()).toMatchObject({ sessions: 1 });
    expect((await submit("captured")).id).toBe(handle.id);
    expect(assess.mock.calls[0]?.[0]).toMatchObject({ agentId: "captured" });
    runtime.unregisterAgent("captured");
    await expect(submit("captured")).rejects.toThrow("Unknown durable agent: captured");
  },
);

it("rejects an unregistered definition default at submission", async () => {
  const goal = defineGoal({
    name: "default",
    version: 1,
    agentId: "missing",
    assess: async () => decision("complete"),
  });
  const runtime = await open(goal);
  await expect(runtime.submitGoal(goal, input)).rejects.toThrow("Unknown durable agent: missing");
  expect((await runtime.listTasks()).tasks).toHaveLength(0);
});

it.each([false, true])(
  "keeps its pinned agent after restart and a changed default (override: %s)",
  async (override) => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-goal-binding-"));
    directories.push(directory);
    const path = join(directory, "goals.sqlite");
    const policy: GoalDefinition = {
      name: "restart",
      version: 1,
      agentId: override ? "unused-default" : "original",
      assess: async ({ previous }) => decision(previous === null ? "blocked" : "complete"),
    };
    const goal = defineGoal(policy);
    const runtime = await open(goal, path);
    runtime.registerAgents([registration("original")]);
    const submission = { ...input, ...(override ? { agentId: "original" } : {}) };
    const handle = await runtime.submitGoal(goal, submission);
    await expect
      .poll(async () => (await handle.snapshot()).task.wait)
      .toEqual({ type: "signal", name: "resume:0" });
    await runtime.close();
    const restoredGoal = defineGoal({ ...policy, agentId: "replacement" });
    const restored = await open(restoredGoal, path);
    const saved = await restored.getTask(handle.id);
    await restored.resume();
    await saved.signal("resume:0", "continue", { feedback: "Continue" });
    await expect.poll(async () => (await saved.snapshot()).task.status).toBe("needs_attention");
    expect((await saved.snapshot()).task.error).toContain("Unknown durable agent: original");
    await expect.poll(() => restored.health().activeTasks).toBe(0);
    restored.registerAgents([registration("original")]);
    const { sessionId, requestId, ...submittedInput } = submission;
    expect(
      restored.taskSubmissionScope({
        name: restoredGoal.name,
        version: restoredGoal.version,
        sessionId,
        requestId,
        input: submittedInput,
      }).agentIds,
    ).toEqual(["original"]);
    // Deduplication uses the original submission and saved binding, not the changed default.
    expect((await restored.submitGoal(restoredGoal, submission)).id).toBe(saved.id);
    await saved.retry();
    expect(await saved.result()).toMatchObject({ sessions: 2 });
    for (const node of (await saved.graph()).nodes.filter((node) => node.agentRunId)) {
      expect((await (await restored.getRun(node.agentRunId!)).snapshot()).run.agentId).toBe(
        "original",
      );
    }
  },
);
