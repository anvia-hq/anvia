import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "@anvia/core/agent";
import { Usage, type CompletionRequest, type CompletionResponse } from "@anvia/core/completion";
import type { AgentObserver, AgentRunStartArgs } from "@anvia/core/observability";
import { DurableRuntime, defineTask, type DurableRuntimeOptions } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, lookup, toolResponse } from "./helpers.js";

const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

type Recorded = {
  runs: AgentRunStartArgs[];
  generations: number[];
  tools: string[];
  events: string[];
  usage: number[];
};

function recorder(): { observer: AgentObserver; recorded: Recorded } {
  const recorded: Recorded = { runs: [], generations: [], tools: [], events: [], usage: [] };
  const observer: AgentObserver = {
    startRun(args) {
      recorded.runs.push(args);
      return {
        startGeneration(generation) {
          recorded.generations.push(generation.turn);
          return { end() {}, error() {} };
        },
        startTool(tool) {
          recorded.tools.push(tool.toolName);
          return { end() {}, error() {} };
        },
        event(event) {
          recorded.events.push(event.name);
        },
        end(end) {
          recorded.usage.push(end.usage.totalTokens);
        },
        error(error) {
          recorded.usage.push(error.usage.totalTokens);
        },
      };
    },
  };
  return { observer, recorded };
}

/** One tool round, then a transient failure on the second model call that durable retries. */
function flakyAgent(observer: AgentObserver, toolOutput = "found") {
  // Replayed turns never reach the model, so the provider sees exactly three calls.
  let calls = 0;
  const pick = (): CompletionResponse => {
    calls += 1;
    if (calls === 1) return toolResponse();
    if (calls === 2) throw new Error("transient provider error");
    return done();
  };
  const tool = vi.fn(async () => toolOutput);
  const agent = new Agent({
    id: "researcher",
    tools: [lookup(tool)],
    observability: { observers: { lens: observer } },
    model: {
      provider: "test",
      modelId: "test",
      capabilities: { ...capabilities, streaming: true },
      completion: async () => pick(),
      async *streamCompletion() {
        yield { type: "final" as const, response: pick() };
      },
    },
  });
  return { agent, tool };
}

async function open(options: Omit<DurableRuntimeOptions, "store">) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    ...options,
  });
  runtimes.push(runtime);
  return runtime;
}

describe("durable observability", () => {
  it.each([false, true])(
    "keeps every execution of a run in one trace without re-observing replayed steps (stream: %s)",
    async (stream) => {
      const { observer, recorded } = recorder();
      const { agent, tool } = flakyAgent(observer);
      const runtime = await open({
        agents: [
          {
            agent,
            version: "1",
            stream,
            toolRecovery: { lookup: "safe" },
            modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
          },
        ],
      });
      const run = await runtime.submit({
        agentId: "researcher",
        sessionId: "session-A",
        requestId: "r1",
        prompt: "hi",
        trace: { name: "support", userId: "user-1", tags: ["beta"], metadata: { plan: "pro" } },
      });
      const result = await run.result();

      expect(result.type).toBe("response");
      expect(tool).toHaveBeenCalledTimes(1);
      expect(recorded.runs).toHaveLength(2);
      const traceId = run.id.replaceAll("-", "");
      for (const started of recorded.runs) {
        expect(started.runId).toBe(run.id);
        expect(started.trace).toEqual({
          name: "support",
          userId: "user-1",
          tags: ["beta"],
          sessionId: "session-A",
          traceId,
          metadata: { plan: "pro", durableRunId: run.id, durableEpoch: 0 },
        });
      }
      // Turn 2 is observed for the failed and the retried attempt; turn 1 and the tool only once.
      expect(recorded.generations).toEqual([1, 2, 2]);
      expect(recorded.tools).toEqual(["lookup"]);
      // Replayed steps add no usage, so the two executions report 3 + 3 rather than 3 + 6.
      expect(recorded.usage).toEqual([3, 3]);
      expect(result.usage.totalTokens).toBe(6);
    },
  );

  it("does not re-observe or re-count a replayed context compaction", async () => {
    const { observer, recorded } = recorder();
    const { agent } = flakyAgent(observer, "payload".repeat(1000));
    const summaryUsage = { ...Usage.empty(), inputTokens: 5, outputTokens: 2, totalTokens: 7 };
    const compactor = vi.fn(async () => ({ summary: "Lookup found it.", usage: summaryUsage }));
    const runtime = await open({
      agents: [
        {
          agent,
          version: "1",
          toolRecovery: { lookup: "safe" },
          modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
          compaction: {
            trigger: { afterTokens: 500 },
            retention: { recentToolTurns: 0 },
            compactor,
          },
        },
      ],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    const result = await run.result();

    expect(compactor).toHaveBeenCalledTimes(1);
    expect(recorded.runs).toHaveLength(2);
    expect(recorded.events).toEqual(["memory.compaction"]);
    // First execution: turn 1 plus the summary. Second: only the retried turn 2.
    expect(recorded.usage).toEqual([10, 3]);
    expect(result.usage.totalTokens).toBe(13);
  });

  it("bounds trace options by the payload limit", async () => {
    const { observer } = recorder();
    const runtime = await open({
      agents: [{ agent: flakyAgent(observer).agent, version: "1" }],
      limits: { maxPayloadBytes: 100 },
    });
    await expect(
      runtime.submit({
        agentId: "researcher",
        sessionId: "s",
        requestId: "r",
        prompt: "hi",
        trace: { metadata: { note: "x".repeat(200) } },
      }),
    ).rejects.toThrow("Durable payload byte limit exceeded.");
  });

  it("traces task-owned agent runs under the task's session and trace options", async () => {
    const { observer, recorded } = recorder();
    const parent = defineTask({
      name: "research",
      version: 1,
      input: z.string(),
      checkpoint: z.boolean(),
      output: z.string(),
      initial: () => false,
      run: async (ctx) =>
        ctx.checkpoint
          ? { status: "completed", output: "ok" }
          : {
              status: "waiting",
              checkpoint: true,
              wait: {
                type: "children",
                ids: [ctx.spawnAgent("child", { agentId: "researcher", prompt: ctx.input })],
                policy: "allSettled",
              },
            },
    });
    const agent = new Agent({
      id: "researcher",
      observability: { observers: { lens: observer } },
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async () => done(),
      },
    });
    const runtime = await open({ tasks: [parent], agents: [{ agent, version: "1" }] });
    const handle = await runtime.submitTask(parent, {
      sessionId: "session-B",
      requestId: "task-1",
      input: "go",
      trace: { userId: "user-2", tags: ["goal"] },
    });
    expect(await handle.result()).toBe("ok");
    const child = (await handle.graph()).nodes[1]!;

    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0]!.trace).toEqual({
      userId: "user-2",
      tags: ["goal"],
      sessionId: "session-B",
      traceId: child.agentRunId!.replaceAll("-", ""),
      metadata: {
        durableRunId: child.agentRunId!,
        durableEpoch: 0,
        durableTaskId: child.id,
        durableRootTaskId: handle.id,
      },
    });
  });

  it("does not re-observe a resumed approval's tool when its epoch is retried", async () => {
    const { observer, recorded } = recorder();
    let calls = 0;
    const tool = vi.fn(async () => "approved");
    const agent = new Agent({
      id: "researcher",
      tools: [{ ...lookup(tool), requiresApproval: true }],
      observability: { observers: { lens: observer } },
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async () => {
          calls += 1;
          if (calls === 1) return toolResponse();
          if (calls === 2) throw new Error("transient provider error");
          return done();
        },
      },
    });
    const runtime = await open({
      agents: [
        {
          agent,
          version: "1",
          toolRecovery: { lookup: "safe" },
          modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
        },
      ],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
    const pending = (await run.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Missing approval");
    await run.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    await run.result();

    expect(tool).toHaveBeenCalledTimes(1);
    // Suspended at approval, executed after it, then restored without a span on the retry.
    expect(recorded.tools).toEqual(["lookup", "lookup"]);
    expect(recorded.runs.map((started) => started.trace?.metadata?.["durableEpoch"])).toEqual([
      0, 1, 1,
    ]);
    expect(new Set(recorded.runs.map((started) => started.trace?.traceId))).toEqual(
      new Set([run.id.replaceAll("-", "")]),
    );
  });

  it("traces graph node runs under the graph's session", async () => {
    const { observer, recorded } = recorder();
    const agent = new Agent({
      id: "researcher",
      observability: { observers: { lens: observer } },
      model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
    });
    const runtime = await open({ agents: [{ agent, version: "1" }] });
    const graph = await runtime.submitGraph({
      sessionId: "session-G",
      requestId: "g",
      tasks: [{ id: "only", agentId: "researcher", prompt: "hi" }],
    });
    const node = (await graph.snapshot()).nodes[0]!;
    await (await runtime.getRun(node.runId)).result();

    expect(recorded.runs[0]!.trace).toMatchObject({
      sessionId: "session-G",
      traceId: node.runId.replaceAll("-", ""),
      metadata: { durableRunId: node.runId, durableGraphId: graph.id },
    });
  });

  it("keeps the first trace options for a duplicate submission", async () => {
    const { observer, recorded } = recorder();
    const agent = new Agent({
      id: "researcher",
      observability: { observers: { lens: observer } },
      model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
    });
    const runtime = await open({ agents: [{ agent, version: "1" }] });
    const submission = { agentId: "researcher", sessionId: "s", requestId: "r", prompt: "hi" };
    const first = await runtime.submit({ ...submission, trace: { userId: "first" } });
    const second = await runtime.submit({ ...submission, trace: { userId: "second" } });
    await first.result();

    expect(second.id).toBe(first.id);
    expect(recorded.runs.map((run) => run.trace?.userId)).toEqual(["first"]);
  });

  it("groups runs under an observability session without sharing execution history", async () => {
    const { observer, recorded } = recorder();
    const requests: CompletionRequest[] = [];
    const agent = new Agent({
      id: "researcher",
      observability: { observers: { lens: observer } },
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async (request) => {
          requests.push(request);
          return done();
        },
      },
    });
    const runtime = await open({ agents: [{ agent, version: "1" }] });
    const trace = { sessionId: "chat-1", userId: "user-1" };
    const first = await runtime.submit({
      agentId: "researcher",
      sessionId: "turns",
      requestId: "one",
      prompt: "first",
      trace,
    });
    await first.result();
    const isolated = await runtime.submit({
      agentId: "researcher",
      sessionId: "side-work",
      requestId: "two",
      prompt: "second",
      trace,
    });
    await isolated.result();

    expect(recorded.runs.map((run) => run.trace)).toEqual([
      {
        sessionId: "chat-1",
        userId: "user-1",
        traceId: first.id.replaceAll("-", ""),
        metadata: { durableRunId: first.id, durableEpoch: 0, durableSessionId: "turns" },
      },
      {
        sessionId: "chat-1",
        userId: "user-1",
        traceId: isolated.id.replaceAll("-", ""),
        metadata: { durableRunId: isolated.id, durableEpoch: 0, durableSessionId: "side-work" },
      },
    ]);
    // Same observability session, separate execution sessions: no history crosses over.
    expect(JSON.stringify(requests[1]?.chatHistory)).not.toContain("first");
    expect((await isolated.snapshot()).run.sessionId).toBe("side-work");
  });

  it("applies a task's observability session to every agent run in its tree", async () => {
    const { observer, recorded } = recorder();
    const parent = defineTask({
      name: "research",
      version: 1,
      input: z.string(),
      checkpoint: z.boolean(),
      output: z.string(),
      initial: () => false,
      run: async (ctx) =>
        ctx.checkpoint
          ? { status: "completed", output: "ok" }
          : {
              status: "waiting",
              checkpoint: true,
              wait: {
                type: "children",
                ids: [ctx.spawnAgent("child", { agentId: "researcher", prompt: ctx.input })],
                policy: "allSettled",
              },
            },
    });
    const agent = new Agent({
      id: "researcher",
      observability: { observers: { lens: observer } },
      model: { provider: "test", modelId: "test", capabilities, completion: async () => done() },
    });
    const runtime = await open({ tasks: [parent], agents: [{ agent, version: "1" }] });
    const handle = await runtime.submitTask(parent, {
      sessionId: "task-work",
      requestId: "task-1",
      input: "go",
      trace: { sessionId: "chat-1" },
    });
    expect(await handle.result()).toBe("ok");

    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0]!.trace).toMatchObject({
      sessionId: "chat-1",
      metadata: { durableSessionId: "task-work", durableRootTaskId: handle.id },
    });
  });

  it("rejects invalid trace options before persisting work", async () => {
    const { observer } = recorder();
    const runtime = await open({ agents: [{ agent: flakyAgent(observer).agent, version: "1" }] });
    await expect(
      runtime.submit({
        agentId: "researcher",
        sessionId: "s",
        requestId: "r",
        prompt: "hi",
        trace: { tags: [""] },
      }),
    ).rejects.toThrow("Invalid durable trace options.");
    await expect(
      runtime.submit({
        agentId: "researcher",
        sessionId: "s",
        requestId: "r",
        prompt: "hi",
        trace: { sessionId: "  " },
      }),
    ).rejects.toThrow("Invalid durable trace options.");
    await expect(
      runtime.submit({
        agentId: "researcher",
        sessionId: "s",
        requestId: "r",
        prompt: "hi",
        trace: { metadata: { note: "x".repeat(20_000) } },
      }),
    ).rejects.toThrow("Invalid durable trace options.");
    expect((await runtime.listRuns()).runs).toHaveLength(0);
  });
});
