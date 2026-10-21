import { Agent } from "@anvia/core/agent";
import {
  Usage,
  type CompletionRequest,
  type CompletionResponse,
  type StreamingCompletionModel,
  type ToolCallPart,
} from "@anvia/core/completion";
import { createQuestionTool, type Tool, type AnyTool } from "@anvia/core/tool";
import type { CreateElicitationRequest, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpTurnBudget } from "../src/types.js";
import { SessionManager } from "../src/session-manager.js";
import type { InteractionClient } from "../src/permissions.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
const call = (id = "reused", name = "write"): ToolCallPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName: name,
  input: { private: "secret" },
});
const response = (choice: CompletionResponse["choice"]): CompletionResponse => ({
  choice,
  usage: { ...Usage.empty(), inputTokens: 1, totalTokens: 1 },
  rawResponse: {},
});
const answer = response([{ type: "text", text: "done" }]);
const allow = { outcome: { outcome: "selected", optionId: "allow_once" } };

async function peer({
  streaming = true,
  turns = [response([call()]), answer],
  budget,
  maxTurns,
  form = false,
  tools,
}: {
  streaming?: boolean;
  turns?: CompletionResponse[];
  budget?: AcpTurnBudget;
  maxTurns?: number;
  form?: boolean;
  tools?: AnyTool[];
} = {}) {
  const requests: CompletionRequest[] = [];
  const execute = vi.fn(() => "private result");
  const tool: Tool = {
    name: "write",
    requiresApproval: true,
    definition: () => ({ name: "write", description: "Write", parameters: { type: "object" } }),
    call: execute,
  };
  const model: StreamingCompletionModel = {
    ...makeAgent().model,
    capabilities: { ...makeAgent().model.capabilities, streaming },
    async completion(request) {
      requests.push(structuredClone(request));
      const next = turns.shift();
      if (!next) throw new Error("Missing fixture turn");
      return next;
    },
    async *streamCompletion(request) {
      yield { type: "final", response: await this.completion(request) };
    },
  };
  const fixture = wireFixture({
    sessionFactory: () => ({
      agent: new Agent({
        id: "permissions",
        model,
        tools: tools ?? [tool],
        maxTurns,
        retries: false,
      }),
      turnBudget: budget ?? {},
      toolPresentation: () => ({
        title: "Write approved file",
        kind: "edit",
        locations: [{ path: "file.ts" }],
      }),
    }),
  });
  cleanup.push(() => fixture.connection.close());
  await fixture.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: form ? { elicitation: { form: {} } } : {},
  });
  const sessionId = (await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] }))
    .result!.sessionId!;
  let seen = 0;
  const callbacks = () =>
    fixture.responses.filter(
      (r) => r.method === "session/request_permission" || r.method === "elicitation/create",
    );
  return {
    ...fixture,
    requests,
    execute,
    sessionId,
    callbacks,
    prompt: () =>
      fixture.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "go" }] }),
    cancel: () =>
      fixture.input.write(
        JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }) + "\n",
      ),
    async next() {
      await vi.waitFor(() => expect(callbacks().length).toBeGreaterThan(seen));
      return callbacks()[seen++]!;
    },
    reply(request: { id?: number }, result: unknown) {
      fixture.input.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    },
  };
}

function updates(fixture: Awaited<ReturnType<typeof peer>>) {
  return fixture.responses
    .filter((r) => r.method === "session/update")
    .map((r) => r.params!.update);
}

describe("ACP continuation bridge", () => {
  it.each([false, true])(
    "allows within one prompt and preserves history and tool identity (streaming=%s)",
    async (streaming) => {
      const fixture = await peer({ streaming, turns: [response([call()]), answer, answer] });
      const pending = fixture.prompt();
      const request = await fixture.next();
      const params = request.params as unknown as RequestPermissionRequest;
      expect(params.options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
      expect(params.toolCall).toMatchObject({
        title: "Write approved file",
        kind: "edit",
        status: "pending",
      });
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(fixture.responses.filter((r) => r.id === 3 && !r.method)).toHaveLength(0);
      fixture.reply(request, allow);
      expect((await pending).result?.stopReason).toBe("end_turn");
      expect(fixture.execute).toHaveBeenCalledOnce();
      expect(updates(fixture).filter((u) => u.sessionUpdate === "tool_call")).toHaveLength(1);
      expect(updates(fixture)).toContainEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: params.toolCall.toolCallId,
        status: "completed",
      });
      expect(JSON.stringify(fixture.responses)).not.toMatch(/secret|private|continuation/);
      expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
      const history = JSON.stringify(fixture.requests.at(-1));
      expect(history).toContain("tool-call");
      expect(history).toContain("private result");
      expect(history.match(/"text":"go"/g)).toHaveLength(2);
    },
  );

  it.each([
    { outcome: { outcome: "selected", optionId: "reject_once" } },
    { outcome: { outcome: "selected", optionId: "allow_always" } },
    { outcome: { outcome: "selected", optionId: "unknown" } },
    { outcome: { outcome: "selected", optionId: 123 } },
    { outcome: { outcome: "selected" } },
    {},
    null,
  ])("rejects invalid/unapproved permission reply %j and resumes with a denial", async (reply) => {
    const fixture = await peer();
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), reply);
    expect((await pending).result?.stopReason).toBe("end_turn");
    expect(fixture.execute).not.toHaveBeenCalled();

    expect(JSON.stringify(fixture.requests.at(-1))).toContain("execution-denied");
    expect(
      updates(fixture).some((u) => u.sessionUpdate === "tool_call_update" && u.status === "failed"),
    ).toBe(true);
  });

  it("rejects RPC permission errors without leaking details", async () => {
    const fixture = await peer();
    const pending = fixture.prompt();
    const request = await fixture.next();
    fixture.input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: "private error" },
      }) + "\n",
    );
    expect((await pending).result?.stopReason).toBe("end_turn");
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.responses)).not.toContain("private error");
  });

  it("ends on a cancelled permission outcome", async () => {
    const fixture = await peer();
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), { outcome: { outcome: "cancelled" } });
    expect((await pending).result?.stopReason).toBe("cancelled");
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("discards a late approval while a new prompt is awaiting its own approval", async () => {
    const fixture = await peer({ turns: [response([call()]), response([call()]), answer] });
    const pending = fixture.prompt();
    const stale = await fixture.next();
    fixture.cancel();
    expect((await pending).result?.stopReason).toBe("cancelled");
    const next = fixture.prompt();
    const current = await fixture.next();
    fixture.reply(stale, allow);
    await fixture.request("authenticate", { methodId: "none" });
    expect(fixture.execute).not.toHaveBeenCalled();
    fixture.reply(current, allow);
    expect((await next).result?.stopReason).toBe("end_turn");
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.responses.filter((r) => r.id === 3 && !r.method)).toHaveLength(1);
  });

  it.each([false, true])(
    "handles multiple pending tools and reused IDs across segments (streaming=%s)",
    async (streaming) => {
      const fixture = await peer({
        streaming,
        turns: [response([call("a"), call("b")]), response([call("a")]), answer],
      });
      const pending = fixture.prompt();
      const ids: string[] = [];
      for (let index = 0; index < 3; index++) {
        const request = await fixture.next();
        ids.push((request.params as unknown as RequestPermissionRequest).toolCall.toolCallId);
        fixture.reply(request, allow);
      }
      expect((await pending).result?.stopReason).toBe("end_turn");
      expect(new Set(ids).size).toBe(3);
      expect(fixture.execute).toHaveBeenCalledTimes(3);
      expect(updates(fixture).filter((u) => u.sessionUpdate === "tool_call")).toHaveLength(3);
      expect(
        updates(fixture)
          .filter((u) => u.sessionUpdate === "tool_call_update")
          .filter((u) => u.status === "completed")
          .map((u) => u.toolCallId),
      ).toEqual(ids);
      expect(
        updates(fixture).filter((u) => u.sessionUpdate === "agent_message_chunk"),
      ).toHaveLength(1);
    },
  );

  it.each([false, true])(
    "keeps a shared model generation budget (streaming=%s)",
    async (streaming) => {
      const fixture = await peer({
        streaming,
        maxTurns: 1,
        turns: [response([call()]), response([call()]), answer],
      });
      const pending = fixture.prompt();
      fixture.reply(await fixture.next(), allow);
      fixture.reply(await fixture.next(), allow);
      expect((await pending).result?.stopReason).toBe("max_turn_requests");
      expect(fixture.requests).toHaveLength(2);
    },
  );

  it.each([false, true])(
    "accumulates estimated cost across suspensions (streaming=%s)",
    async (streaming) => {
      const estimates: number[] = [];
      const fixture = await peer({
        streaming,
        turns: [response([call()]), response([call()]), answer],
        budget: {
          maxCost: 2,
          estimateCost: (usage) => {
            estimates.push(usage.totalTokens);
            return usage.totalTokens;
          },
        },
      });
      const pending = fixture.prompt();
      fixture.reply(await fixture.next(), allow);
      expect((await pending).result?.stopReason).toBe("max_turn_requests");
      expect(estimates).toEqual([1, 2]);
      expect(fixture.callbacks()).toHaveLength(1);
      expect(fixture.execute).toHaveBeenCalledOnce();
    },
  );

  it("honors an explicit model generation cap", async () => {
    const fixture = await peer({ budget: { maxModelCalls: 1 } });
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), allow);
    expect((await pending).result?.stopReason).toBe("max_turn_requests");
    expect(fixture.requests).toHaveLength(1);
  });

  it("counts cumulative segment usage once, including segments with no model call", async () => {
    const estimates: number[] = [];
    const tool: Tool = {
      name: "write",
      requiresApproval: true,
      definition: () => ({ name: "write", description: "Write", parameters: { type: "object" } }),
      call: () => "result",
    };
    const fixture = await peer({
      tools: [
        tool,
        {
          ...tool,
          name: "read",
          requiresApproval: false,
          definition: () => ({ name: "read", description: "Read", parameters: { type: "object" } }),
        },
      ],
      turns: [response([call("r", "read")]), response([call("a"), call("b")]), answer],
      budget: {
        maxCost: 3,
        estimateCost: (usage) => {
          estimates.push(usage.totalTokens);
          return usage.totalTokens;
        },
      },
    });
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), allow);
    fixture.reply(await fixture.next(), allow);
    expect((await pending).result?.stopReason).toBe("max_turn_requests");
    expect(estimates).toEqual([1, 2, 3]);
    expect(fixture.requests).toHaveLength(3);
  });
});

const questions = [
  {
    id: "strategy",
    text: "Which strategy?",
    choices: [
      { label: "Safe", value: "safe" },
      { label: "Fast", value: "fast" },
    ],
  },
  { id: "__proto__", text: "Details?", allowCustom: true },
];
const questionCall = { ...call("question", "ask_user"), input: { questions } };

describe("ACP form elicitation", () => {
  it.each([false, true])("resumes validated answers (streaming=%s)", async (streaming) => {
    const fixture = await peer({
      streaming,
      form: true,
      tools: [createQuestionTool()],
      turns: [response([questionCall]), answer],
    });
    const pending = fixture.prompt();
    const request = await fixture.next();
    expect(request.method).toBe("elicitation/create");
    expect(request.params as unknown as CreateElicitationRequest).toMatchObject({
      mode: "form",
      sessionId: fixture.sessionId,
      requestedSchema: {
        required: ["q0", "q1"],
        properties: {
          q0: {
            oneOf: [
              { const: "safe", title: "Safe" },
              { const: "fast", title: "Fast" },
            ],
          },
          q1: { type: "string" },
        },
      },
    });
    fixture.reply(request, { action: "accept", content: { q0: "safe", q1: "detail" } });
    expect((await pending).result?.stopReason).toBe("end_turn");
    expect(JSON.stringify(fixture.requests.at(-1))).toContain('"value":"safe"');
  });

  it("fails safely without form support", async () => {
    const fixture = await peer({
      tools: [createQuestionTool()],
      turns: [response([questionCall])],
    });
    expect((await fixture.prompt()).error?.data?.kind).toBe("unsupported_interaction");
    expect(fixture.callbacks()).toHaveLength(0);
  });

  it.each([
    { action: "accept", content: { q0: "unknown", q1: "detail" } },
    { action: "accept", content: { q0: "safe" } },
    { action: "accept", content: { q0: "safe", q1: " " } },
    { action: "accept", content: { q0: "safe", q1: 42 } },
    { action: "accept", content: { q0: "safe", q1: "detail", extra: "no" } },
    { action: "future" },
    {},
  ])("rejects malformed answers %j", async (reply) => {
    const fixture = await peer({
      form: true,
      tools: [createQuestionTool()],
      turns: [response([questionCall])],
    });
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), reply);
    expect((await pending).error?.data?.kind).toBe("invalid_interaction_response");
    expect(fixture.requests).toHaveLength(1);
  });

  it.each(["cancel", "decline"])("stops on %s", async (action) => {
    const fixture = await peer({
      form: true,
      tools: [createQuestionTool()],
      turns: [response([questionCall])],
    });
    const pending = fixture.prompt();
    fixture.reply(await fixture.next(), { action });
    expect((await pending).result?.stopReason).toBe("cancelled");
    expect(fixture.requests).toHaveLength(1);
  });
});

describe("prompt-owned interaction lifetime", () => {
  async function direct(budget?: AcpTurnBudget) {
    const execute = vi.fn(() => "result");
    const requests = vi.fn(async () => response([call()]));
    const manager = new SessionManager({
      sessionFactory: () => ({
        agent: new Agent({
          id: "lifetime",
          model: { ...makeAgent().model, completion: requests },
          tools: [
            {
              name: "write",
              requiresApproval: true,
              definition: () => ({
                name: "write",
                description: "Write",
                parameters: { type: "object" },
              }),
              call: execute,
            },
          ],
        }),
        turnBudget: budget ?? {},
      }),
    });
    cleanup.push(() => manager.close());
    const id = await manager.create(process.cwd(), {
      readTextFile: false,
      writeTextFile: false,
      terminal: false,
      elicitationForm: false,
    });
    return { manager, current: manager.get(id), execute, requests };
  }

  it.each(["queued", "disconnect"])(
    "invalidates a real suspended continuation on %s cancellation",
    async (timing) => {
      const { current, manager, execute } = await direct();
      const started = deferred<AbortSignal>();
      const reply = deferred<"allow">();
      const client: InteractionClient = {
        permission: async (_tool, signal) => {
          started.resolve(signal);
          return reply.promise;
        },
        question: async () => "cancel",
      };
      const pending = current.prompt([{ type: "text", text: "go" }], undefined, client);
      const settled = pending.catch((error: unknown) => error);
      const signal = await started.promise;
      if (timing === "queued") {
        reply.resolve("allow");
        current.cancel();
        expect(await settled).toBe("cancelled");
      } else {
        await manager.close();
        reply.resolve("allow");
        expect(await settled).toMatchObject({ kind: "connection_closed" });
      }
      expect(signal.aborted).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("keeps the original deadline through multiple permission waits", async () => {
    const { current, execute } = await direct({ maxDurationMs: 1000 });
    const first = deferred();
    const second = deferred<AbortSignal>();
    const allowFirst = deferred<"allow">();
    const allowSecond = deferred<"allow">();
    let count = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = current.prompt([{ type: "text", text: "go" }], undefined, {
      permission: async (_tool, signal) => {
        if (count++ === 0) {
          first.resolve();
          return allowFirst.promise;
        }
        second.resolve(signal);
        return allowSecond.promise;
      },
      question: async () => "cancel",
    });
    await first.promise;
    await vi.advanceTimersByTimeAsync(600);
    allowFirst.resolve("allow");
    const signal = await second.promise;
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toBe("max_turn_requests");
    expect(signal.aborted).toBe(true);
    allowSecond.resolve("allow");
    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();
    expect(await current.memory.load({ scope: { sessionId: current.context.sessionId } })).toEqual(
      [],
    );
  });
});
