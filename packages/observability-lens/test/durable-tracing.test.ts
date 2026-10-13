import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@anvia/core/agent";
import {
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type JsonObject,
  Usage,
} from "@anvia/core/completion";
import type { AgentObserver } from "@anvia/core/observability";
import { type AnyTool, createQuestionTool } from "@anvia/core/tool";
import { DurableRuntime, type DurableRuntimeOptions, defineGoal, defineTask } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LensClient } from "../src/tracing";
import { type ExportedSpan, startOtlpServer } from "./otlp-server";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const capabilities: CompletionModel["capabilities"] = {
  streaming: false,
  tools: true,
  toolChoice: true,
  imageInput: false,
  documentInput: false,
  outputSchema: true,
  reasoning: false,
};

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    rawResponse: {},
  };
}

const done = () => response([{ type: "text", text: "done" }]);
const toolCall = (toolName = "lookup", input: JsonObject = {}) =>
  response([{ type: "tool-call", toolCallId: "call-1", toolName, input }]);
const hasToolResult = (request: CompletionRequest) =>
  request.chatHistory.some((message) => message.role === "tool");

function lookup(options: { requiresApproval?: boolean } = {}): AnyTool {
  return {
    name: "lookup",
    ...options,
    definition: () => ({
      name: "lookup",
      description: "Look up data",
      parameters: { type: "object", properties: {} },
    }),
    call: async () => "found",
  };
}

function agent(
  observer: AgentObserver,
  completion: (request: CompletionRequest, signal?: AbortSignal) => Promise<CompletionResponse>,
  tools: AnyTool[] = [],
): Agent {
  return new Agent({
    id: "researcher",
    tools,
    observability: { observers: { lens: observer } },
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request, options) => completion(request, options?.abortSignal),
    },
  });
}

/** Resolves when the model call is aborted, as a provider SDK would. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function lens() {
  const server = await startOtlpServer();
  const client = new LensClient({
    baseUrl: server.baseUrl,
    publicKey: "public",
    secretKey: "secret",
    serviceName: "durable-lens-test",
  });
  cleanups.push(() => server.close());
  cleanups.push(() => client.close());
  return {
    observer: client.observer(),
    client,
    async spans(): Promise<ExportedSpan[]> {
      await client.flush();
      return server.spans();
    },
  };
}

async function open(options: DurableRuntimeOptions): Promise<DurableRuntime> {
  const runtime = await DurableRuntime.open(options);
  cleanups.push(() => runtime.close());
  return runtime;
}

function journalPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-lens-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "journal.sqlite");
}

const traceIdOf = (runId: string) => runId.replaceAll("-", "");

type TraceView = {
  spans: ExportedSpan[];
  roots: ExportedSpan[];
  named(prefix: string): ExportedSpan[];
};

/**
 * Asserts the shape Lens needs: every span stays in the durable run's trace, each execution
 * attempt contributes one parentless root, and no span points at a parent that was never emitted.
 */
function durableTrace(spans: ExportedSpan[], runId: string): TraceView {
  const traceId = traceIdOf(runId);
  const own = spans.filter((span) => span.traceId === traceId);
  const ids = new Set(own.map((span) => span.spanId));
  expect(own.length).toBeGreaterThan(0);
  for (const span of own) {
    expect(span.parentSpanId === "" || ids.has(span.parentSpanId), span.name).toBe(true);
  }
  const roots = own
    .filter((span) => span.parentSpanId === "")
    .sort((left, right) => Number(left.startTimeUnixNano - right.startTimeUnixNano));
  for (const root of roots) {
    expect(root.name).toBe("agent.run");
    expect(root.attributes["anvia.run.id"]).toBe(runId);
  }
  return {
    spans: own,
    roots,
    named: (prefix) => own.filter((span) => span.name.startsWith(prefix)),
  };
}

/**
 * Mirrors Lens trace-status materialization: the latest Anvia run root decides, a suspended run is
 * still running, and a trace without any root has not finished.
 */
function lensStatus(view: TraceView): "running" | "ok" | "error" | "unset" {
  const latest = view.roots.at(-1);
  if (latest === undefined || latest.attributes["anvia.run.status"] === "suspended") {
    return "running";
  }
  return latest.statusCode === 2 ? "error" : latest.statusCode === 1 ? "ok" : "unset";
}

function expectChildrenOf(view: TraceView, parent: ExportedSpan, prefix: string, count: number) {
  const children = view.named(prefix).filter((span) => span.parentSpanId === parent.spanId);
  expect(children, prefix).toHaveLength(count);
}

describe("native durable tracing through LensClient", () => {
  it("exports a completed run as one rooted trace that Lens marks completed", async () => {
    const { observer, spans } = await lens();
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      agents: [
        {
          agent: agent(
            observer,
            async (request) => (hasToolResult(request) ? done() : toolCall()),
            [lookup()],
          ),
          version: "1",
        },
      ],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "session-1",
      requestId: "r1",
      prompt: "hi",
    });
    expect(await run.result()).toMatchObject({ type: "response" });

    const view = durableTrace(await spans(), run.id);
    expect(view.roots).toHaveLength(1);
    const [root] = view.roots;
    expect(root?.attributes["anvia.run.status"]).toBe("completed");
    expect(root?.attributes["anvia.trace.session_id"]).toBe("session-1");
    expectChildrenOf(view, root!, "model.turn.", 2);
    expectChildrenOf(view, root!, "tool.lookup", 1);
    expect(lensStatus(view)).toBe("ok");
  });

  it("marks a failed run failed", async () => {
    const { observer, spans } = await lens();
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      agents: [
        {
          agent: agent(observer, async () => {
            throw new Error("provider rejected the request");
          }),
          version: "1",
        },
      ],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await expect(run.result()).rejects.toBeDefined();

    const view = durableTrace(await spans(), run.id);
    expect(view.roots).toHaveLength(1);
    expect(view.roots[0]?.attributes["anvia.run.status"]).toBe("failed");
    expect(lensStatus(view)).toBe("error");
  });

  it("marks a cancelled run failed rather than running", async () => {
    const { observer, spans } = await lens();
    const model = vi.fn(async (_request: CompletionRequest, signal?: AbortSignal) =>
      untilAborted(signal),
    );
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      agents: [{ agent: agent(observer, model), version: "1" }],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    await run.cancel();
    await expect(run.result()).rejects.toMatchObject({ status: "cancelled" });

    // The run settles before the aborted execution unwinds and ends its root span.
    let exported: ExportedSpan[] = [];
    await vi.waitFor(async () => {
      exported = await spans();
      expect(exported.some((span) => span.parentSpanId === "")).toBe(true);
    });
    const view = durableTrace(exported, run.id);
    expect(view.roots).toHaveLength(1);
    expect(view.roots[0]?.attributes["anvia.run.status"]).toBe("cancelled");
    expect(lensStatus(view)).toBe("error");
  });

  it("keeps an approval-suspended run running, then completes it in the same trace", async () => {
    const { observer, spans } = await lens();
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      agents: [
        {
          agent: agent(
            observer,
            async (request) => (hasToolResult(request) ? done() : toolCall()),
            [lookup({ requiresApproval: true })],
          ),
          version: "1",
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

    // Every exported span has ended here, but the run is waiting for a human.
    const waiting = durableTrace(await spans(), run.id);
    expect(waiting.roots).toHaveLength(1);
    expect(waiting.roots[0]?.attributes["anvia.run.status"]).toBe("suspended");
    expect(lensStatus(waiting)).toBe("running");

    const pending = (await run.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Expected an approval");
    await run.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    expect(await run.result()).toMatchObject({ type: "response" });

    const view = durableTrace(await spans(), run.id);
    expect(view.roots).toHaveLength(2);
    const [suspended, resumed] = view.roots;
    // The first turn is replayed on resume, so each of the two model calls is observed once.
    expectChildrenOf(view, suspended!, "model.turn.", 1);
    expectChildrenOf(view, resumed!, "model.turn.", 1);
    // The approval-suspended call and the approved execution.
    expectChildrenOf(view, suspended!, "tool.lookup", 1);
    expectChildrenOf(view, resumed!, "tool.lookup", 1);
    expect(lensStatus(view)).toBe("ok");
  });

  it("resumes a question across a journal close and reopen in the same trace", async () => {
    const { observer, spans } = await lens();
    const path = journalPath();
    const ask = () =>
      agent(
        observer,
        async (request) =>
          hasToolResult(request)
            ? done()
            : toolCall("ask_user", { questions: [{ id: "details", text: "Which report?" }] }),
        [createQuestionTool({ name: "ask_user", description: "Ask a question" })],
      );
    const first = await DurableRuntime.open({
      store: new SqliteDurableStore(path),
      agents: [{ agent: ask(), version: "1" }],
    });
    const run = await first.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
    const pending = (await run.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Expected a question");
    await first.close();
    expect(lensStatus(durableTrace(await spans(), run.id))).toBe("running");

    const second = await open({
      store: new SqliteDurableStore(path),
      agents: [{ agent: ask(), version: "1" }],
    });
    const reopened = await second.getRun(run.id);
    await reopened.respond(pending.interaction.id, {
      type: "tool-question",
      answers: [{ questionId: "details", value: "The annual report" }],
    });
    expect(await reopened.result()).toMatchObject({ type: "response" });

    const view = durableTrace(await spans(), run.id);
    expect(view.roots).toHaveLength(2);
    // Two model calls in total: the replayed question turn is not observed again.
    for (const root of view.roots) expectChildrenOf(view, root, "model.turn.", 1);
    expect(view.named("tool.ask_user")).toHaveLength(2);
    expect(lensStatus(view)).toBe("ok");
  });

  it("recovers an interrupted run after reopening the journal", async () => {
    const { observer, spans } = await lens();
    const path = journalPath();
    const interrupted = vi.fn(async (_request: CompletionRequest, signal?: AbortSignal) =>
      untilAborted(signal),
    );
    const first = await DurableRuntime.open({
      store: new SqliteDurableStore(path),
      agents: [{ agent: agent(observer, interrupted), version: "1" }],
    });
    const run = await first.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    await first.close();

    const second = await open({
      store: new SqliteDurableStore(path),
      agents: [{ agent: agent(observer, async () => done()), version: "1" }],
    });
    await second.resume();
    expect(await (await second.getRun(run.id)).result()).toMatchObject({ type: "response" });

    const view = durableTrace(await spans(), run.id);
    expect(view.roots).toHaveLength(2);
    expect(view.roots.map((root) => root.attributes["anvia.run.status"])).toEqual([
      "cancelled",
      "completed",
    ]);
    // The interrupted attempt must not keep the recovered run failed.
    expect(lensStatus(view)).toBe("ok");
  });

  it("retries a transient model failure without re-observing replayed steps", async () => {
    const { observer, spans } = await lens();
    let calls = 0;
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      agents: [
        {
          agent: agent(observer, async () => {
            calls += 1;
            if (calls === 1) return toolCall();
            if (calls === 2) throw new Error("transient provider error");
            return done();
          }, [lookup()]),
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
    expect(await run.result()).toMatchObject({ type: "response" });

    const view = durableTrace(await spans(), run.id);
    expect(view.roots.map((root) => root.attributes["anvia.run.status"])).toEqual([
      "failed",
      "completed",
    ]);
    // Turn 1 and the tool are restored from the journal on retry; only turn 2 runs twice.
    expect(view.named("model.turn.").map((span) => span.name)).toEqual([
      "model.turn.1",
      "model.turn.2",
      "model.turn.2",
    ]);
    expect(view.named("tool.lookup")).toHaveLength(1);
    expect(lensStatus(view)).toBe("ok");
  });

  it("roots every goal session run in its own completed trace", async () => {
    const { observer, spans } = await lens();
    const goal = defineGoal({
      name: "builder",
      version: 1,
      agentId: "researcher",
      assess: async ({ previous }) => ({
        status: previous === null ? "continue" : "complete",
        progressKey: previous === null ? "one" : "two",
        summary: "Search index implemented",
        next: "Verify search",
        evidence: ["Index tests pass"],
      }),
    });
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      tasks: [goal],
      agents: [{ agent: agent(observer, async () => done()), version: "1" }],
    });
    const handle = await runtime.submitGoal(goal, {
      sessionId: "project",
      requestId: "goal",
      objective: "Build search",
      acceptanceCriteria: ["Search tests pass"],
      limits: { maxSessions: 5, maxTotalModelTurns: 10, maxConsecutiveNoProgressSessions: 2 },
    });
    expect(await handle.result()).toMatchObject({ sessions: 2 });

    const exported = await spans();
    const runIds = [
      ...new Set(exported.flatMap((span) => span.attributes["anvia.run.id"] ?? [])),
    ] as string[];
    expect(runIds).toHaveLength(2);
    for (const runId of runIds) {
      const view = durableTrace(exported, runId);
      expect(view.roots).toHaveLength(1);
      expect(view.roots[0]?.attributes["anvia.trace.session_id"]).toBe("project");
      expect(lensStatus(view)).toBe("ok");
    }
  });

  it("roots a spawned subagent run in its own completed trace", async () => {
    const { observer, spans } = await lens();
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
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      tasks: [parent],
      agents: [{ agent: agent(observer, async () => done()), version: "1" }],
    });
    const handle = await runtime.submitTask(parent, {
      sessionId: "session-B",
      requestId: "task-1",
      input: "go",
    });
    expect(await handle.result()).toBe("ok");
    const child = (await handle.graph()).nodes[1];
    if (child?.agentRunId === undefined) throw new Error("Expected a subagent run");

    const view = durableTrace(await spans(), child.agentRunId);
    expect(view.roots).toHaveLength(1);
    expect(view.roots[0]?.attributes["anvia.trace.session_id"]).toBe("session-B");
    expect(lensStatus(view)).toBe("ok");
  });

  it("keeps concurrent runs in separate traces", async () => {
    const { observer, spans } = await lens();
    const count = 4;
    let started = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      maxConcurrentRuns: count,
      agents: [
        {
          agent: agent(
            observer,
            async (request) => {
              if (hasToolResult(request)) return done();
              started += 1;
              if (started === count) release();
              // Hold every first turn open so all runs have live spans at the same time.
              await allStarted;
              return toolCall();
            },
            [lookup()],
          ),
          version: "1",
        },
      ],
    });
    const runs = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        runtime.submit({
          agentId: "researcher",
          sessionId: `session-${index}`,
          requestId: `r${index}`,
          prompt: "hi",
        }),
      ),
    );
    await Promise.all(runs.map((run) => run.result()));

    const exported = await spans();
    expect(new Set(exported.map((span) => span.traceId))).toEqual(
      new Set(runs.map((run) => traceIdOf(run.id))),
    );
    for (const [index, run] of runs.entries()) {
      const view = durableTrace(exported, run.id);
      expect(view.roots).toHaveLength(1);
      expect(view.roots[0]?.attributes["anvia.trace.session_id"]).toBe(`session-${index}`);
      expectChildrenOf(view, view.roots[0]!, "model.turn.", 2);
      expectChildrenOf(view, view.roots[0]!, "tool.lookup", 1);
      expect(lensStatus(view)).toBe("ok");
    }
  });
});

describe("observability sessions through LensClient", () => {
  it("groups a multi-turn chat with goals, subagents, and resumed approval under one session", async () => {
    const { observer, spans } = await lens();
    const requests = new Map<string, CompletionRequest[]>();
    const record = (agentId: string, request: CompletionRequest) =>
      requests.set(agentId, [...(requests.get(agentId) ?? []), request]);
    const chatAgent = new Agent({
      id: "researcher",
      tools: [lookup({ requiresApproval: true })],
      observability: { observers: { lens: observer } },
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async (request) => {
          record("researcher", request);
          const last = JSON.stringify(request.chatHistory.at(-1));
          return last.includes("look it up") && !hasToolResult(request) ? toolCall() : done();
        },
      },
    });
    const worker = new Agent({
      id: "worker",
      observability: { observers: { lens: observer } },
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async (request) => {
          record("worker", request);
          return done();
        },
      },
    });
    const goal = defineGoal({
      name: "builder",
      version: 1,
      agentId: "worker",
      assess: async ({ previous }) => ({
        status: previous === null ? "continue" : "complete",
        progressKey: previous === null ? "one" : "two",
        summary: "Search index implemented",
        next: "Verify search",
        evidence: ["Index tests pass"],
      }),
    });
    const research = defineTask({
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
                ids: [ctx.spawnAgent("child", { agentId: "worker", prompt: ctx.input })],
                policy: "allSettled",
              },
            },
    });
    const runtime = await open({
      store: new SqliteDurableStore(":memory:"),
      tasks: [goal, research],
      agents: [
        { agent: chatAgent, version: "1" },
        { agent: worker, version: "1" },
      ],
    });
    // The application's chat identity: unique per chat, so it is scoped to the owning user.
    const chat = { sessionId: "chat-7f3a", userId: "user-1" };
    const otherChat = { sessionId: "chat-91c2", userId: "user-2" };

    const turn1 = await runtime.submit({
      agentId: "researcher",
      sessionId: "chat-7f3a-turns",
      requestId: "turn-1",
      prompt: "hello",
      trace: chat,
    });
    await turn1.result();
    const turn2 = await runtime.submit({
      agentId: "researcher",
      sessionId: "chat-7f3a-turns",
      requestId: "turn-2",
      prompt: "look it up",
      trace: chat,
    });
    await vi.waitFor(async () => expect((await turn2.snapshot()).run.status).toBe("waiting"));
    const pending = (await turn2.snapshot()).run.outcome;
    if (pending?.type !== "interaction") throw new Error("Expected an approval");
    await turn2.respond(pending.interaction.id, { type: "tool-approval", approved: true });
    await turn2.result();
    const goalHandle = await runtime.submitGoal(goal, {
      sessionId: "chat-7f3a-goal",
      requestId: "goal-1",
      objective: "Build search",
      acceptanceCriteria: ["Search tests pass"],
      limits: { maxSessions: 5, maxTotalModelTurns: 10, maxConsecutiveNoProgressSessions: 2 },
      trace: chat,
    });
    expect(await goalHandle.result()).toMatchObject({ sessions: 2 });
    const researchHandle = await runtime.submitTask(research, {
      sessionId: "chat-7f3a-research",
      requestId: "research-1",
      input: "dig deeper",
      trace: chat,
    });
    expect(await researchHandle.result()).toBe("ok");
    const other = await runtime.submit({
      agentId: "researcher",
      sessionId: "chat-91c2-turns",
      requestId: "turn-1",
      prompt: "hello",
      trace: otherChat,
    });
    await other.result();

    const exported = await spans();
    const roots = exported.filter((span) => span.parentSpanId === "");
    const bySession = (sessionId: string) =>
      roots.filter((root) => root.attributes["anvia.trace.session_id"] === sessionId);
    const chatRoots = bySession(chat.sessionId);

    // Every root belongs to one of the two chats; neither chat sees the other's user.
    expect(chatRoots.length + bySession(otherChat.sessionId).length).toBe(roots.length);
    expect(new Set(chatRoots.map((root) => root.attributes["anvia.trace.user_id"]))).toEqual(
      new Set(["user-1"]),
    );
    expect(bySession(otherChat.sessionId).map((root) => root.traceId)).toEqual([
      traceIdOf(other.id),
    ]);

    // One trace per durable run: two turns, two goal rounds, and one subagent. The approval
    // pause and its resumed attempt share the turn's trace.
    const chatRunIds = [...new Set(chatRoots.map((root) => root.attributes["anvia.run.id"]))];
    expect(chatRunIds).toHaveLength(5);
    expect(new Set(chatRoots.map((root) => root.traceId))).toEqual(
      new Set(chatRunIds.map((runId) => traceIdOf(runId as string))),
    );
    expect(durableTrace(exported, turn1.id).roots).toHaveLength(1);
    const resumed = durableTrace(exported, turn2.id);
    expect(resumed.roots.map((root) => root.attributes["anvia.run.status"])).toEqual([
      "suspended",
      "completed",
    ]);
    for (const runId of chatRunIds)
      expect(lensStatus(durableTrace(exported, runId as string))).toBe("ok");

    // Execution stays isolated: each run keeps its own durable session.
    expect(
      new Set(chatRoots.map((root) => root.attributes["anvia.trace.metadata.durableSessionId"])),
    ).toEqual(new Set(["chat-7f3a-turns", "chat-7f3a-goal", "chat-7f3a-research"]));
    expect((await turn2.snapshot()).run.sessionId).toBe("chat-7f3a-turns");
    // The second turn continues the first; goal and subagent runs never see the chat history.
    expect(JSON.stringify(requests.get("researcher")?.at(-1)?.chatHistory)).toContain("hello");
    for (const request of requests.get("worker") ?? []) {
      expect(JSON.stringify(request.chatHistory)).not.toContain("look it up");
    }
    expect(requests.get("worker")).toHaveLength(3);
  });
});

describe("non-durable tracing through LensClient", () => {
  it("generates a fresh trace per run when no trace id is supplied", async () => {
    const { observer, spans } = await lens();
    const plain = agent(observer, async () => done());
    await plain.generate({ prompt: "one" });
    await plain.generate({ prompt: "two" });

    const roots = (await spans()).filter((span) => span.parentSpanId === "");
    expect(roots).toHaveLength(2);
    expect(new Set(roots.map((root) => root.traceId)).size).toBe(2);
  });

  it("keeps an explicit parent observation", async () => {
    const { observer, spans } = await lens();
    const traceId = "1234567890abcdef1234567890abcdef";
    const parentObservationId = "abcdef1234567890";
    await agent(observer, async () => done()).generate({
      prompt: "hi",
      trace: { traceId, parentObservationId },
    });

    const [root] = (await spans()).filter((span) => span.name === "agent.run");
    expect(root).toMatchObject({ traceId, parentSpanId: parentObservationId });
  });
});
