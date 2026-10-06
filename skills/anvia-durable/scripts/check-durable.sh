#!/bin/sh
# No-network compatibility smoke check against the app's installed packages.
# Creates/removes only its own temporary SQLite directory, never the app's database.
set -eu

case "$#" in
  0) ;;
  2)
    if [ "$1" != "--dir" ]; then
      echo "Usage: $0 [--dir <app-root>]" >&2
      exit 2
    fi
    cd -- "$2"
    ;;
  *)
    echo "Usage: $0 [--dir <app-root>]" >&2
    exit 2
    ;;
esac

# An eval module resolves packages from the app working directory, even if this
# skill is installed elsewhere (for example under .claude/skills).
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [major, minor] = process.versions.node.split(".").map(Number);
assert.ok(major > 22 || (major === 22 && minor >= 16), "Node.js 22.16+ is required.");
const [{ Agent }, { Usage }, { createTool }, { DurableRuntime, defineTask }, { SqliteDurableStore }, { z }] =
  await Promise.all([
    import("@anvia/core/agent"), import("@anvia/core/completion"), import("@anvia/core/tool"),
    import("@anvia/durable"), import("@anvia/durable/sqlite"), import("zod"),
  ]);

let modelCalls = 0;
let toolCalls = 0;
let effectCalls = 0;
const agent = new Agent({
  id: "smoke-worker",
  model: {
    provider: "local-smoke",
    modelId: "fake",
    capabilities: { streaming: false, tools: true, toolChoice: true, imageInput: false,
      documentInput: false, outputSchema: false, reasoning: false },
    completion: async (request) => {
      modelCalls++;
      return {
        choice: request.chatHistory.some(message => message.role === "tool")
          ? [{ type: "text", text: "done" }]
          : [{ type: "tool-call", toolCallId: "lookup-1", toolName: "lookup", input: {} }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  },
  tools: [createTool({
    name: "lookup", description: "Return a local fixture value.",
    inputSchema: z.object({}), outputSchema: z.number(),
    execute: (_input, context) => {
      assert.equal(typeof context.operationId, "string");
      toolCalls++;
      return 7;
    },
  })],
});
const definition = defineTask({
  name: "durable-smoke", version: 1,
  input: z.null(), checkpoint: z.enum(["start", "review"]), output: z.string(),
  initial: () => "start",
  run: async ctx => {
    // Intentionally re-enter this effect in every phase to check committed-result reuse.
    assert.equal(await ctx.effect("seed", null, async () => { effectCalls++; return "seed"; }, "safe"), "seed");
    const child = ctx.spawnAgent("worker", { agentId: "smoke-worker", prompt: "Use lookup." });
    if (ctx.checkpoint === "start") return {
      status: "waiting", checkpoint: "review",
      wait: { type: "children", ids: [child], policy: "allSettled" },
    };
    const outcome = ctx.children().find(value => value.id === child)?.outcome;
    assert.deepEqual(outcome, { status: "completed", output: "done" });
    if (ctx.signalValue("release") === undefined) return {
      status: "waiting", checkpoint: "review", wait: { type: "signal", name: "release" },
    };
    assert.equal(ctx.signalValue("release"), true);
    return { status: "completed", output: outcome.output };
  },
});

const directory = await mkdtemp(join(tmpdir(), "anvia-durable-skill-"));
let runtime;
const deadline = AbortSignal.timeout(15_000);
const open = () => DurableRuntime.open({
  store: new SqliteDurableStore(join(directory, "smoke.sqlite")),
  agents: [{ agent, version: "v1", toolRecovery: { lookup: "safe" } }],
  tasks: [definition], maxConcurrentTasks: 1, maxConcurrentRuns: 1,
});
try {
  runtime = await open();
  await runtime.resume();
  const submitted = { sessionId: "smoke", requestId: "one", input: null };
  const task = await runtime.submitTask(definition, submitted);
  while (true) {
    deadline.throwIfAborted();
    const { task: saved } = await task.snapshot();
    if (saved.status === "waiting" && saved.wait?.type === "signal") break;
    assert.ok(!["failed", "cancelled", "needs_attention"].includes(saved.status), saved.error);
    await delay(10, undefined, { signal: deadline });
  }
  const before = await task.graph();
  assert.equal(before.nodes.length, 2);
  const agentRunId = before.nodes.find(value => value.agentRunId !== undefined).agentRunId;
  assert.equal((await (await runtime.getRun(agentRunId)).snapshot()).run.status, "completed");
  assert.deepEqual([modelCalls, toolCalls, effectCalls], [2, 1, 1]);
  await runtime.close();

  runtime = await open();
  await runtime.resume();
  const reopened = await runtime.submitTask(definition, submitted);
  assert.equal(reopened.id, task.id);
  assert.deepEqual((await reopened.graph()).nodes.map(value => value.id), before.nodes.map(value => value.id));
  await reopened.signal("release", "delivery-one", true);
  await reopened.signal("release", "delivery-one", true);
  assert.equal(await reopened.result({ abortSignal: deadline }), "done");
  assert.deepEqual([modelCalls, toolCalls, effectCalls], [2, 1, 1]);
  assert.equal(runtime.health().ready, true);
  console.log("durable OK: owned agent/tool, effect reuse, persisted wait, reopen, stable IDs, duplicate signal");
} finally {
  try { await runtime?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
JS
