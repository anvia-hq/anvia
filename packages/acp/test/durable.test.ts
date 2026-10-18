import { Agent } from "@anvia/core/agent";
import {
  Usage,
  type CompletionRequest,
  type CompletionResponse,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import { createQuestionTool, type AnyTool } from "@anvia/core/tool";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DurableRuntime } from "../../durable/src/index.js";
import { SqliteDurableStore } from "../../durable/src/sqlite.js";
import type { ToolRecovery } from "../../durable/src/types.js";
import { createDurableSessionBinding } from "../src/durable.js";
import { SessionManager } from "../src/session-manager.js";
import { FileAcpSessionStore, InMemoryAcpSessionStore } from "../src/session-store.js";
import type { AcpSessionBinding, AcpSessionStore } from "../src/index.js";
import type { SessionUpdate } from "../src/events.js";
import { deferred, makeAgent } from "./helpers.js";

const managers: SessionManager[] = [];
const runtimes: DurableRuntime[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close();
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const capabilities = {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
};
const prompt = [{ type: "text" as const, text: "hello" }];
const response = (choice: CompletionResponse["choice"]): CompletionResponse => ({
  choice,
  usage: Usage.empty(),
  rawResponse: {},
});
const answer = () => response([{ type: "text", text: "done" }]);
const call = () =>
  response([{ type: "tool-call", toolCallId: "write-1", toolName: "write", input: {} }]);
const tool = (execute: AnyTool["call"], approval = false): AnyTool => ({
  name: "write",
  requiresApproval: approval,
  definition: () => ({ name: "write", description: "Write", parameters: { type: "object" } }),
  call: execute,
});
function agent(completion = makeAgent().model.completion, tools: AnyTool[] = []) {
  return new Agent({
    id: "durable-fixture",
    model: { ...makeAgent().model, completion },
    tools,
    retries: false,
  });
}
async function open(a = agent(), path = ":memory:", recovery?: ToolRecovery) {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path) });
  runtimes.push(runtime);
  const toolRecovery: Record<string, ToolRecovery> = {};
  if (recovery) toolRecovery.write = recovery;
  const binding = createDurableSessionBinding(runtime, {
    agent: a,
    version: "1",
    toolRecovery,
  });
  await runtime.resume();
  return { runtime, binding };
}
function manager(
  binding: AcpSessionBinding,
  sessionStore: AcpSessionStore = new InMemoryAcpSessionStore(),
) {
  const value = new SessionManager({ sessionFactory: () => binding, sessionStore });
  managers.push(value);
  return value;
}
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "acp-durable-"));
  dirs.push(dir);
  return dir;
}
async function runFor(runtime: DurableRuntime, sessionId: string) {
  const list = await runtime.listRuns({ sessionId });
  return runtime.getRun(list.runs[0]!.id);
}
async function waiting(runtime: DurableRuntime, sessionId: string, status = "waiting") {
  await vi.waitFor(async () =>
    expect((await (await runFor(runtime, sessionId)).status()).status).toBe(status),
  );
  return runFor(runtime, sessionId);
}
const allow = { permission: async () => "allow" as const, question: async () => "cancel" as const };

it("keeps durable history across load and shared factory bindings without replaying model work", async () => {
  const completion = vi.fn(async (_request: CompletionRequest) => answer());
  const { binding, runtime } = await open(agent(completion));
  const store = new InMemoryAcpSessionStore();
  const first = manager(binding, store);
  const id = await first.create(process.cwd(), capabilities);
  expect(await first.get(id).prompt(prompt)).toBe("end_turn");
  await first.close();
  const second = manager(binding, store);
  const replay: unknown[] = [];
  await second.restore(id, process.cwd(), capabilities, [], undefined, async (entry) => {
    replay.push(entry);
  });
  expect(completion).toHaveBeenCalledTimes(1);
  expect(replay).toContainEqual({ type: "text", text: "done" });
  expect(await second.get(id).prompt(prompt)).toBe("end_turn");
  expect(completion.mock.calls[1]![0].chatHistory).toHaveLength(3);
  expect((await store.get(id))!.messages).toHaveLength(4);
  expect((await runtime.listRuns({ sessionId: id })).runs).toHaveLength(2);
});

it("detaches pending approval, ignores a late grant, and reattaches via respond with stable tool IDs", async () => {
  const execute = vi.fn(async () => "private receipt");
  const completion = vi.fn(async (request) =>
    request.chatHistory.some((m: { role: string }) => m.role === "tool") ? answer() : call(),
  );
  const { binding, runtime } = await open(agent(completion, [tool(execute, true)]));
  const store = new InMemoryAcpSessionStore();
  const first = manager(binding, store);
  const id = await first.create(process.cwd(), capabilities);
  const grant = deferred<"allow">();
  expect(await first.list()).toEqual({ sessions: [] });
  const requested = deferred();
  const updates: SessionUpdate[] = [];
  const original = first
    .get(id)
    .prompt(
      prompt,
      async (u) => {
        updates.push(u);
      },
      {
        ...allow,
        permission: () => {
          requested.resolve();
          return grant.promise;
        },
      },
    )
    .catch((error) => error.kind);
  await requested.promise;
  const run = await waiting(runtime, id);
  await first.close();
  expect(await original).toBe("connection_closed");
  grant.resolve("allow");
  expect((await run.status()).status).toBe("waiting");
  expect(execute).not.toHaveBeenCalled();
  const second = manager(binding, store);
  expect((await store.get(id))!.messages).toEqual([]);
  expect((await second.list()).sessions).toMatchObject([{ sessionId: id }]);
  await second.restore(id, process.cwd(), capabilities);
  await expect(second.get(id).prompt(prompt)).rejects.toMatchObject({ kind: "session_busy" });
  const resumed: SessionUpdate[] = [];
  expect(
    await second.get(id).prompt(
      [],
      async (u) => {
        resumed.push(u);
      },
      allow,
    ),
  ).toBe("end_turn");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(resumed.find((u) => u.type === "tool")?.id).toBe(
    updates.find((u) => u.type === "tool")?.id,
  );
  expect(JSON.stringify(resumed)).not.toContain("private receipt");
  expect((await runtime.listRuns({ sessionId: id })).runs).toHaveLength(1);
  expect((await store.get(id))!.pendingRun).toBeUndefined();
});

it.each(["completed", "manual", "idempotent"] as const)(
  "recovers %s effects after reopening both stores",
  async (mode) => {
    const dir = await directory();
    const database = join(dir, "runtime.sqlite");
    const records = join(dir, "sessions.json");
    const entered = deferred();
    const operations: string[] = [];
    let interrupted = true;
    const execute = vi.fn(async (_input, context) => {
      operations.push(context!.operationId!);
      if (interrupted && mode !== "completed") {
        entered.resolve();
        await new Promise<void>((resolve) =>
          context!.abortSignal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return "receipt";
    });
    const completion = async (
      request: CompletionRequest,
      options?: { abortSignal?: AbortSignal },
    ) => {
      if (!request.chatHistory.some((m) => m.role === "tool")) return call();
      if (interrupted && mode === "completed") {
        entered.resolve();
        await new Promise<void>((resolve) =>
          options!.abortSignal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return answer();
    };
    const first = await open(
      agent(completion, [tool(execute)]),
      database,
      mode === "idempotent" ? "idempotent" : "manual",
    );
    const sessions = manager(first.binding, new FileAcpSessionStore(records));
    const id = await sessions.create(dir, capabilities);
    expect(await sessions.list()).toEqual({ sessions: [] });
    const result = sessions
      .get(id)
      .prompt(prompt)
      .catch((error) => error.kind);
    await entered.promise;
    await sessions.close();
    expect(await result).toBe("connection_closed");
    await first.runtime.close();
    interrupted = false;
    const second = await open(
      agent(completion, [tool(execute)]),
      database,
      mode === "idempotent" ? "idempotent" : "manual",
    );
    const restored = manager(second.binding, new FileAcpSessionStore(records));
    expect((await restored.store.get(id))!.messages).toEqual([]);
    expect((await restored.list()).sessions).toMatchObject([{ sessionId: id }]);
    await restored.restore(id, dir, capabilities);
    if (mode === "manual") {
      const run = await waiting(second.runtime, id, "needs_attention");
      await expect(restored.get(id).prompt([])).rejects.toMatchObject({
        kind: "recovery_required",
      });
      expect(execute).toHaveBeenCalledTimes(1);
      const snapshot = await run.snapshot();
      await run.resolveTool(snapshot.run.blockedOperation!, {
        type: "text",
        value: "verified receipt",
      });
    }
    expect(await restored.get(id).prompt([])).toBe("end_turn");
    expect(execute).toHaveBeenCalledTimes(mode === "idempotent" ? 2 : 1);
    expect(operations.every((id) => id === operations[0] && id.includes("/"))).toBe(true);
  },
);

it("cancels a restored pending run explicitly and refuses deletion while it is detached", async () => {
  const execute = vi.fn(async () => "receipt");
  const { binding, runtime } = await open(agent(async () => call(), [tool(execute, true)]));
  const sessions = manager(binding);
  const id = await sessions.create(process.cwd(), capabilities);
  const result = sessions
    .get(id)
    .prompt(prompt, undefined, { ...allow, permission: () => new Promise(() => {}) })
    .catch((error) => error.kind);
  const run = await waiting(runtime, id);
  await sessions.closeSession(id);
  expect(await result).toBe("connection_closed");
  await expect(sessions.deleteSession(id)).rejects.toMatchObject({ kind: "session_busy" });
  await sessions.restore(id, process.cwd(), capabilities);
  await sessions.cancel(id);
  expect((await run.status()).status).toBe("cancelled");
  expect(execute).not.toHaveBeenCalled();
  await sessions.deleteSession(id);
  expect(await sessions.store.get(id)).toBeUndefined();
});

it("saves intent before submitting and retries a failed final session save without executing again", async () => {
  const completion = vi.fn(async (_request: CompletionRequest) => answer());
  const { binding, runtime } = await open(agent(completion));
  let fail = "intent";
  class Store extends InMemoryAcpSessionStore {
    override async put(record: Parameters<InMemoryAcpSessionStore["put"]>[0]) {
      if ((fail === "intent" && record.pendingRun) || (fail === "result" && record.messages.length))
        throw new Error("private disk error");
      await super.put(record);
    }
  }
  const sessions = manager(binding, new Store());
  const id = await sessions.create(process.cwd(), capabilities);
  await expect(sessions.get(id).prompt(prompt)).rejects.toMatchObject({ kind: "execution_failed" });
  expect((await runtime.listRuns()).runs).toHaveLength(0);
  fail = "result";
  await expect(sessions.get(id).prompt(prompt)).rejects.toMatchObject({ kind: "execution_failed" });
  expect(completion).toHaveBeenCalledTimes(1);
  fail = "";
  await sessions.cancel(id); // A completed runtime result cannot be discarded by cancellation.
  expect((await sessions.store.get(id))!.pendingRun).toBeDefined();
  expect(await sessions.get(id).prompt([])).toBe("end_turn");
  expect(completion).toHaveBeenCalledTimes(1);
});

it("preserves a completed result when deletion races a new pending turn", async () => {
  const { binding } = await open(agent(async () => answer()));
  const read = deferred();
  const release = deferred();
  let pause = false;
  class Store extends InMemoryAcpSessionStore {
    override async get(id: string) {
      const record = await super.get(id);
      if (pause) {
        pause = false;
        read.resolve();
        await release.promise;
      }
      return record;
    }
    override async put(record: Parameters<InMemoryAcpSessionStore["put"]>[0]) {
      if (record.messages.length) throw new Error("private disk error");
      await super.put(record);
    }
  }
  const store = new Store();
  const sessions = manager(binding, store);
  const id = await sessions.create(process.cwd(), capabilities);
  const current = sessions.get(id);
  pause = true;
  const deleting = sessions.deleteSession(id);
  const deleted = expect(deleting).rejects.toMatchObject({ kind: "session_busy" });
  await read.promise;
  await expect(current.prompt(prompt)).rejects.toMatchObject({ kind: "execution_failed" });
  release.resolve();
  await deleted;
  expect((await store.get(id))!.pendingRun).toBeDefined();
});

it("reconstructs multiple approval segments and reused call IDs after detach", async () => {
  const execute = vi.fn(async () => "receipt");
  const turns = [
    response([
      { type: "tool-call", toolCallId: "a", toolName: "write", input: {} },
      { type: "tool-call", toolCallId: "b", toolName: "write", input: {} },
    ]),
    response([{ type: "tool-call", toolCallId: "a", toolName: "write", input: {} }]),
    answer(),
  ];
  const completion = vi.fn(async () => turns.shift()!);
  const { binding } = await open(agent(completion, [tool(execute, true)]));
  const store = new InMemoryAcpSessionStore();
  const first = manager(binding, store);
  const id = await first.create(process.cwd(), capabilities);
  const requested = deferred();
  const ids: string[] = [];
  const original = first
    .get(id)
    .prompt(prompt, undefined, {
      ...allow,
      permission: async (tool) => {
        ids.push(tool.id);
        if (ids.length < 3) return "allow";
        requested.resolve();
        return new Promise(() => {});
      },
    })
    .catch((error) => error.kind);
  await requested.promise;
  await first.close();
  expect(await original).toBe("connection_closed");
  const second = manager(binding, store);
  await second.restore(id, process.cwd(), capabilities);
  const updates: SessionUpdate[] = [];
  expect(
    await second.get(id).prompt(
      [],
      async (u) => {
        updates.push(u);
      },
      {
        ...allow,
        permission: async (tool) => {
          expect(tool.id).toBe(ids[2]);
          return "allow";
        },
      },
    ),
  ).toBe("end_turn");
  expect(updates.filter((u) => u.type === "tool").map((u) => u.id)).toEqual(ids);
  expect(
    updates
      .filter((u) => u.type === "tool-update")
      .filter((u) => u.status === "completed")
      .map((u) => u.id),
  ).toEqual(ids);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(completion).toHaveBeenCalledTimes(3);
});

it.each(["readTextFile", "writeTextFile", "terminal"] as const)(
  "rejects the connection-owned %s editor tool in durable sessions",
  async (capability) => {
    const { binding } = await open();
    const editor = new SessionManager({
      sessionFactory: () => binding,
      editorTools: { [capability]: true },
    });
    managers.push(editor);
    await expect(
      editor.create(
        process.cwd(),
        { ...capabilities, [capability]: true },
        [],
        () => ({}) as never,
      ),
    ).rejects.toMatchObject({ kind: "configuration_error" });
  },
);

it("rejects per-turn budgets, config changes and execution-mode changes on restore", async () => {
  const { binding } = await open();
  await expect(
    manager({ ...binding, turnBudget: { maxModelCalls: 1 } }).create(process.cwd(), capabilities),
  ).rejects.toMatchObject({ kind: "configuration_error" });
  const store = new InMemoryAcpSessionStore();
  const sessions = manager(binding, store);
  const id = await sessions.create(process.cwd(), capabilities);
  await expect(sessions.get(id).setConfig("mode", "ask")).rejects.toMatchObject({
    kind: "invalid_config",
  });
  await sessions.close();
  await expect(
    manager({ agent: agent() }, store).restore(id, process.cwd(), capabilities),
  ).rejects.toMatchObject({ kind: "configuration_error" });
});

it("refuses to switch an ephemeral session to durable execution during a config change", async () => {
  const { binding } = await open();
  const ephemeral = makeAgent();
  const sessions = new SessionManager({
    readOnlyMode: true,
    sessionFactory: ({ config }) => (config.mode === "ask" ? ephemeral : binding),
  });
  managers.push(sessions);
  const id = await sessions.create(process.cwd(), capabilities);
  await expect(sessions.get(id).setConfig("mode", "read-only")).rejects.toMatchObject({
    kind: "configuration_error",
  });
  expect(sessions.get(id).durable).toBe(false);
  expect((await sessions.store.get(id))!.config.mode).toBe("ask");
  expect(await sessions.get(id).prompt(prompt)).toBe("end_turn");
});

it("settles persisted model-turn exhaustion as max_turn_requests and accepts a subsequent prompt", async () => {
  const a = new Agent({
    id: "limited",
    maxTurns: 0,
    retries: false,
    model: { ...makeAgent().model, completion: async () => call() },
    tools: [tool(async () => "receipt")],
  });
  const { binding, runtime } = await open(a);
  const sessions = manager(binding);
  const id = await sessions.create(process.cwd(), capabilities);
  for (let i = 0; i < 2; i++) {
    expect(await sessions.get(id).prompt(prompt)).toBe("max_turn_requests");
    expect((await sessions.store.get(id))!.pendingRun).toBeUndefined();
    expect((await sessions.store.get(id))!.messages).toEqual([]);
  }
  expect((await runtime.listRuns({ sessionId: id })).runs).toHaveLength(2);
});

it("lets a running model complete after disconnect and copies its result on reattachment", async () => {
  const entered = deferred();
  const release = deferred();
  const completion = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return answer();
  });
  const { binding, runtime } = await open(agent(completion));
  const store = new InMemoryAcpSessionStore();
  const first = manager(binding, store);
  const id = await first.create(process.cwd(), capabilities);
  const result = first
    .get(id)
    .prompt(prompt)
    .catch((error) => error.kind);
  await entered.promise;
  await first.close();
  expect(await result).toBe("connection_closed");
  const run = await runFor(runtime, id);
  expect((await run.status()).status).toBe("running");
  release.resolve();
  await run.result();
  const second = manager(binding, store);
  await second.restore(id, process.cwd(), capabilities);
  expect(await second.get(id).prompt([])).toBe("end_turn");
  expect(completion).toHaveBeenCalledTimes(1);
  expect((await store.get(id))!.pendingRun).toBeUndefined();
});

it("restores a pending question and persists the validated answer through respond", async () => {
  const dir = await directory();
  const database = join(dir, "runtime.sqlite");
  const records = join(dir, "sessions.json");
  const questions = [{ id: "choice", text: "Which approach?", allowCustom: true }];
  const completion = vi.fn(async (request: CompletionRequest) =>
    request.chatHistory.some((m) => m.role === "tool")
      ? answer()
      : response([
          { type: "tool-call", toolCallId: "ask-1", toolName: "ask_user", input: { questions } },
        ]),
  );
  const first = await open(agent(completion, [createQuestionTool()]), database);
  const sessions = manager(first.binding, new FileAcpSessionStore(records));
  const caps = { ...capabilities, elicitationForm: true };
  const id = await sessions.create(dir, caps);
  const asked = deferred<string>();
  const original = sessions
    .get(id)
    .prompt(prompt, undefined, {
      ...allow,
      question: async (toolId) => {
        asked.resolve(toolId);
        return new Promise(() => {});
      },
    })
    .catch((error) => error.kind);
  const toolId = await asked.promise;
  const run = await waiting(first.runtime, id);
  expect((await run.snapshot()).run.outcome!.type).toBe("interaction");
  await sessions.close();
  expect(await original).toBe("connection_closed");
  await first.runtime.close();
  const second = await open(agent(completion, [createQuestionTool()]), database);
  const restored = manager(second.binding, new FileAcpSessionStore(records));
  await restored.restore(id, dir, caps);
  const decision = {
    type: "tool-question" as const,
    answers: [{ questionId: "choice", value: "safe" }],
  };
  expect(
    await restored.get(id).prompt([], undefined, {
      ...allow,
      question: async (restoredToolId, prompts) => {
        expect(restoredToolId).toBe(toolId);
        expect(prompts).toEqual(questions);
        return decision;
      },
    }),
  ).toBe("end_turn");
  const snapshot = await (await runFor(second.runtime, id)).snapshot();
  expect(Object.values(snapshot.run.responses)).toEqual([decision]);
  expect(completion).toHaveBeenCalledTimes(2);
});

it("projects only committed output when a durable streaming attempt is retried", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  let attempts = 0;
  const model: StreamingCompletionModel = {
    ...makeAgent().model,
    capabilities: { ...makeAgent().model.capabilities, streaming: true },
    completion: async () => {
      throw new Error("Must use streaming");
    },
    async *streamCompletion() {
      attempts++;
      yield { type: "text_delta", delta: attempts === 1 ? "partial attempt" : "done" };
      if (attempts === 1) throw new Error("private provider error");
      yield { type: "final", response: answer() };
    },
  };
  const binding = createDurableSessionBinding(runtime, {
    agent: new Agent({ id: "streaming", model, retries: false }),
    version: "1",
    stream: true,
    modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
  });
  await runtime.resume();
  const sessions = manager(binding);
  const id = await sessions.create(process.cwd(), capabilities);
  const updates: SessionUpdate[] = [];
  expect(
    await sessions.get(id).prompt(prompt, async (u) => {
      updates.push(u);
    }),
  ).toBe("end_turn");
  expect(attempts).toBe(2);
  expect(updates).toEqual([{ type: "text", text: "done" }]);
});

it("keeps durable registration validation rather than bypassing unsupported callbacks", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const unsupported = new Agent({ id: "callbacks", model: makeAgent().model, lifecycle: {} });
  expect(() => createDurableSessionBinding(runtime, { agent: unsupported, version: "1" })).toThrow(
    "Durable agents currently support static local tools",
  );
});
