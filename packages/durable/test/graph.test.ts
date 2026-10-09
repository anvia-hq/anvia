import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableRuntime, type DurableGraphSubmission } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, response, toolResponse } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const directories: string[] = [];
const definition: DurableGraphSubmission = {
  sessionId: "project",
  requestId: "research",
  tasks: [
    { id: "left", agentId: "researcher", prompt: "LEFT" },
    { id: "right", agentId: "researcher", prompt: "RIGHT" },
    { id: "join", agentId: "researcher", prompt: "SYNTHESIS", dependsOn: ["left", "right"] },
  ],
};
async function open(agent = makeAgent(async () => done()), path = ":memory:") {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
    maxConcurrentRuns: 2,
  });
  runtimes.push(runtime);
  return runtime;
}
function database() {
  const directory = mkdtempSync(join(tmpdir(), "anvia-graph-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("durable task graphs", () => {
  it("runs independent roots concurrently and releases the join only after both commit", async () => {
    let releaseLeft!: () => void;
    let releaseRight!: () => void;
    const left = new Promise<void>((resolve) => {
      releaseLeft = resolve;
    });
    const right = new Promise<void>((resolve) => {
      releaseRight = resolve;
    });
    const model = vi.fn(async (request) => {
      const input = JSON.stringify(request.chatHistory);
      if (input.includes("SYNTHESIS")) {
        expect(input).toContain("left result");
        expect(input).toContain("right result");
        return done();
      }
      const isLeft = input.includes("LEFT");
      await (isLeft ? left : right);
      return response([{ type: "text", text: isLeft ? "left result" : "right result" }]);
    });
    const runtime = await open(makeAgent(model));
    const graph = await runtime.submitGraph(definition);
    try {
      await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(2));
      const snapshot = await graph.snapshot();
      expect(snapshot.edges).toEqual([
        { source: "left", target: "join" },
        { source: "right", target: "join" },
      ]);
      expect(snapshot.nodes[2]?.wait).toEqual({ type: "dependencies", taskIds: ["left", "right"] });
      releaseLeft();
      await (await runtime.getRun(snapshot.nodes[0]!.runId)).result();
      expect(model).toHaveBeenCalledTimes(2);
      expect((await graph.snapshot()).nodes[2]?.wait).toEqual({
        type: "dependencies",
        taskIds: ["right"],
      });
      releaseRight();
      const events = [];
      for await (const event of graph.stream({ after: snapshot.cursor })) events.push(event);
      expect(
        events.every((event) => event.graphId === graph.id && event.sequence > snapshot.cursor),
      ).toBe(true);
      const completed = await graph.snapshot();
      expect(completed.status).toBe("completed");
      expect(completed.nodes[2]?.output).toBe("done");
      expect(model).toHaveBeenCalledTimes(3);
      const join = await (await runtime.getRun(completed.nodes[2]!.runId)).snapshot();
      expect(join.run.history).toEqual([]);
      expect((await runtime.listRuns({ sessionId: "project" })).runs).toEqual([]);
      expect((await runtime.listGraphs({ sessionId: "project" })).graphs[0]?.id).toBe(graph.id);
    } finally {
      releaseLeft();
      releaseRight();
    }
  });

  it("atomically validates and deduplicates graph submissions", async () => {
    const runtime = await open();
    const graph = await runtime.submitGraph(definition);
    expect((await runtime.submitGraph(definition)).id).toBe(graph.id);
    await expect(
      runtime.submitGraph({ ...definition, tasks: definition.tasks.slice(0, 1) }),
    ).rejects.toThrow("different submission");
    const invalid = [
      [{ id: "one", agentId: "researcher", prompt: "hi", dependsOn: ["missing"] }],
      [
        { id: "one", agentId: "researcher", prompt: "hi", dependsOn: ["two"] },
        { id: "two", agentId: "researcher", prompt: "hi", dependsOn: ["one"] },
      ],
      [
        { id: "one", agentId: "researcher", prompt: "hi" },
        { id: "one", agentId: "researcher", prompt: "hi" },
      ],
      [{ id: "one", agentId: "missing-agent", prompt: "hi" }],
    ];
    for (const tasks of invalid)
      await expect(
        runtime.submitGraph({ ...definition, requestId: "invalid", tasks }),
      ).rejects.toThrow();
    expect((await runtime.listGraphs()).graphs).toHaveLength(1);
    expect((await runtime.listRuns()).runs).toHaveLength(3);
  });

  it("blocks descendants on failure and wakes them automatically after explicit retry succeeds", async () => {
    const model = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(done());
    const runtime = await open(makeAgent(model));
    const graph = await runtime.submitGraph({
      ...definition,
      tasks: [definition.tasks[0]!, { ...definition.tasks[2]!, dependsOn: ["left"] }],
    });
    await vi.waitFor(async () => expect((await graph.snapshot()).status).toBe("blocked"));
    const snapshot = await graph.snapshot();
    expect(snapshot.nodes[1]?.wait).toEqual({ type: "dependency_failed", taskIds: ["left"] });
    expect(model).toHaveBeenCalledTimes(1);
    await (await runtime.getRun(snapshot.nodes[0]!.runId)).retry();
    for await (const _event of graph.stream({ after: snapshot.cursor })) {
      /* observe completion */
    }
    expect((await graph.snapshot()).status).toBe("completed");
    expect(model).toHaveBeenCalledTimes(3);
  });

  it("restores pending approvals and dependencies on reopen without automatically approving", async () => {
    const path = database();
    const tool = vi.fn(async () => "approved");
    const agent = makeAgent(
      async (request) => (hasToolResult(request) ? done() : toolResponse()),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const original = await open(agent, path);
    const graph = await original.submitGraph({
      ...definition,
      tasks: [definition.tasks[0]!, { ...definition.tasks[2]!, dependsOn: ["left"] }],
    });
    await vi.waitFor(async () => expect((await graph.snapshot()).status).toBe("waiting"));
    const before = await graph.snapshot();
    expect(before.nodes[0]?.wait?.type).toBe("interaction");
    await original.close();
    const restarted = await open(agent, path);
    await restarted.resume();
    const restored = await restarted.getGraph(graph.id);
    const after = await restored.snapshot();
    expect(after.nodes[0]?.interaction?.id).toBe(before.nodes[0]?.interaction?.id);
    expect(after.nodes[1]?.wait?.type).toBe("dependencies");
    expect(tool).not.toHaveBeenCalled();
    await (
      await restarted.getRun(after.nodes[0]!.runId)
    ).respond(after.nodes[0]!.interaction!.id, { type: "tool-approval", approved: true });
    await vi.waitFor(async () =>
      expect((await restored.snapshot()).nodes[1]?.status).toBe("waiting"),
    );
    expect(tool).toHaveBeenCalledTimes(1);
    await restored.cancel();
    expect((await restored.snapshot()).status).toBe("cancelled");
  });

  it("cancels a blocked graph durably and refuses subsequent node retries", async () => {
    const path = database();
    const model = vi.fn(async () => {
      throw new Error("failed");
    });
    const runtime = await open(makeAgent(model), path);
    const graph = await runtime.submitGraph({
      ...definition,
      tasks: [definition.tasks[0]!, { ...definition.tasks[2]!, dependsOn: ["left"] }],
    });
    await vi.waitFor(async () => expect((await graph.snapshot()).status).toBe("blocked"));
    const before = await graph.snapshot();
    await graph.cancel();
    const events = [];
    for await (const event of graph.stream({ after: before.cursor })) events.push(event);
    expect(
      events.some(
        (event) =>
          typeof event.data === "object" && event.data !== null && "graphCancelled" in event.data,
      ),
    ).toBe(true);
    await expect((await runtime.getRun(before.nodes[0]!.runId)).retry()).rejects.toThrow(
      "Graph is cancelled",
    );
    await runtime.close();
    const restarted = await open(makeAgent(model), path);
    await restarted.resume();
    expect((await (await restarted.getGraph(graph.id)).snapshot()).status).toBe("cancelled");
    expect(model).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3, 4, 5])(
    "upgrades schema version %s on acquisition while preserving old runs",
    async (version) => {
      const path = database();
      const original = await open(undefined, path);
      const run = await original.submit({
        agentId: "researcher",
        sessionId: "old",
        requestId: "old",
        prompt: "hello",
      });
      await run.result();
      await original.close();
      const previous = new DatabaseSync(path);
      previous.prepare("UPDATE anvia_durable_owner SET version = ?").run(version);
      previous.close();
      const restarted = await open(undefined, path);
      expect(await (await restarted.getRun(run.id)).result()).toMatchObject({ output: "done" });
      await restarted.close();
      const updated = new DatabaseSync(path);
      expect(updated.prepare("SELECT version FROM anvia_durable_owner").get()?.version).toBe(6);
      updated.close();
    },
  );
});
