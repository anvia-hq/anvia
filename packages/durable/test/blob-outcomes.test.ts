import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import type { CompletionRequest, JsonValue } from "@anvia/core/completion";
import { blobStatements, hydrateValue } from "../src/blob.js";
import { z } from "zod";
import { DurableRuntime, defineTask, type DurableGraphSubmission } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { Agent, capabilities, done, makeAgent, response } from "./helpers.js";

/** Over the 64 KiB inline threshold, so every reader below reads it back from the blob table. */
const big = "result-".repeat(20_000);

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-blob-outcomes-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, agent: ReturnType<typeof makeAgent>, maxConcurrentRuns = 2) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
    maxConcurrentRuns,
  });
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const graph: DurableGraphSubmission = {
  sessionId: "project",
  requestId: "large-dependency",
  tasks: [
    { id: "left", agentId: "researcher", prompt: "LEFT" },
    { id: "join", agentId: "researcher", prompt: "SYNTHESIS", dependsOn: ["left"] },
  ],
};

it("passes an oversized graph dependency result, intact, into the downstream prompt", async () => {
  const model = vi.fn(async (request: CompletionRequest) => {
    const input = JSON.stringify(request.chatHistory);
    if (input.includes("SYNTHESIS")) {
      // The dependency suffix carries the full 140 KB result, not a null placeholder.
      expect(input).toContain("Task dependency results");
      expect(input.includes(big)).toBe(true);
      return done();
    }
    return response([{ type: "text", text: big }]);
  });
  const runtime = await open(database(), makeAgent(model));
  const submitted = await runtime.submitGraph(graph);
  await vi.waitFor(async () => {
    const snapshot = await submitted.snapshot();
    expect(snapshot.nodes.every((node) => node.status === "completed")).toBe(true);
  });
  const snapshot = await submitted.snapshot();
  // The graph's own node output is restored too, not `null`.
  expect(JSON.stringify(snapshot.nodes[0]?.output)).toContain(big);
  expect(model).toHaveBeenCalledTimes(2);
});

it("replays an interrupted model call whose journal input is stored inline, as schema version 9 did", async () => {
  // A model call that never returns is in flight when the runtime closes. On reopen it is re-run
  // in the same epoch, so its saved input is compared with the new request. The saved input is
  // rewritten here to the inline form that version 9 stored; the comparison must still match.
  const path = database();
  const context = [{ id: "doc-1", text: big }];
  const hangs = new Agent({
    id: "researcher",
    context,
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (_request, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () =>
            reject(new Error("Interrupted by close.")),
          );
        }),
    },
  });
  const runtime = await open(path, hangs);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "inline-replay",
    prompt: "hello",
  });
  await vi.waitFor(async () => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare("SELECT record FROM anvia_durable_operations").all() as Array<{
        record: string;
      }>;
      expect(rows.some((row) => row.record.includes('"status":"started"'))).toBe(true);
    } finally {
      db.close();
    }
  });
  await runtime.close();

  const db = new DatabaseSync(path);
  const blobs = blobStatements(db);
  const rows = db
    .prepare("SELECT run_id, key, record FROM anvia_durable_operations WHERE run_id = ?")
    .all(run.id) as Array<{ run_id: string; key: string; record: string }>;
  const modelRows = rows.filter(
    (row) => (JSON.parse(row.record) as { kind: string }).kind === "model",
  );
  expect(modelRows.length).toBeGreaterThan(0);
  // The stored form must really be externalized, or this test proves nothing.
  expect(modelRows.some((row) => row.record.includes("anvia:blob"))).toBe(true);
  for (const row of modelRows) {
    const record = JSON.parse(row.record) as { input: JsonValue };
    const inline = hydrateValue(blobs, record.input);
    db.prepare("UPDATE anvia_durable_operations SET record = ? WHERE run_id = ? AND key = ?").run(
      JSON.stringify({ ...record, input: inline }),
      row.run_id,
      row.key,
    );
  }
  db.close();

  const finished = new Agent({
    id: "researcher",
    context,
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: async () => done(),
    },
  });
  const restarted = await open(path, finished);
  await restarted.resume();
  const restored = await restarted.getRun(run.id);
  const outcome = await restored.result();
  expect(outcome.text).toBe("done");
  expect((await restored.snapshot()).run.status).toBe("completed");
});

it("hands an oversized owned-agent output to its parent task intact", async () => {
  const parent = defineTask({
    name: "large-child-output",
    version: 1,
    input: z.null(),
    checkpoint: z.boolean(),
    output: z.unknown(),
    initial: () => false,
    run: async (ctx) => {
      if (!ctx.checkpoint)
        return {
          status: "waiting",
          checkpoint: true,
          wait: {
            type: "children",
            ids: [ctx.spawnAgent("agent", { agentId: "researcher", prompt: "write" })],
            policy: "allSettled",
          },
        };
      return {
        status: "completed",
        output: (ctx.children()[0]!.outcome as { output?: JsonValue } | undefined)?.output ?? null,
      };
    },
  });
  const runtimeOptions = {
    tasks: [parent],
    agents: [
      {
        agent: makeAgent(async () => response([{ type: "text", text: big }])),
        version: "1",
      },
    ],
  };
  const runtime = await DurableRuntime.open({
    ...runtimeOptions,
    store: new SqliteDurableStore(":memory:"),
  });
  runtimes.push(runtime);
  const handle = await runtime.submitTask(parent, {
    sessionId: "tasks",
    requestId: "large-child",
    input: null,
  });
  const result = await handle.result();
  // The child's full output reaches the parent; a `null` placeholder would fail here.
  expect(JSON.stringify(result)).toContain(big);
});

it("gives a goal round the full output of an owned agent run through agentRun", async () => {
  const parent = defineTask({
    name: "large-agent-run",
    version: 1,
    input: z.null(),
    checkpoint: z.string().nullable(),
    output: z.unknown(),
    initial: () => null,
    run: async (ctx) => {
      if (ctx.checkpoint === null) {
        const childId = ctx.spawnAgent("agent", { agentId: "researcher", prompt: "write" });
        return {
          status: "waiting",
          checkpoint: childId,
          wait: { type: "children", ids: [childId], policy: "allSettled" },
        };
      }
      const run = ctx.agentRun(ctx.checkpoint);
      return {
        status: "completed",
        output: (run.outcome as { output?: JsonValue } | undefined)?.output ?? null,
      };
    },
  });
  const runtime = await DurableRuntime.open({
    tasks: [parent],
    agents: [
      { agent: makeAgent(async () => response([{ type: "text", text: big }])), version: "1" },
    ],
    store: new SqliteDurableStore(":memory:"),
  });
  runtimes.push(runtime);
  const handle = await runtime.submitTask(parent, {
    sessionId: "goal-round",
    requestId: "agent-run",
    input: null,
  });
  expect(JSON.stringify(await handle.result())).toContain(big);
});
