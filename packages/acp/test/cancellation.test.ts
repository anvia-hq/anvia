import { Agent, AgentRunCancelledError } from "@anvia/core/agent";
import { Usage, type CompletionModel, type StreamingCompletionModel } from "@anvia/core/completion";
import type { McpTool } from "@anvia/core/mcp";
import type { Tool } from "@anvia/core/tool";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import type { AcpOptions } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const text = [{ type: "text" as const, text: "hello" }];
const capabilities = {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function session(options: AcpOptions) {
  const manager = new SessionManager(options);
  cleanup.push(() => manager.close());
  const id = await manager.create(process.cwd(), capabilities);
  return { manager, session: manager.get(id), id };
}

async function peer(model: CompletionModel) {
  const fixture = wireFixture({
    sessionFactory: () => ({ agent: new Agent({ id: "cancel", model, retries: false }) }),
  });
  cleanup.push(() => fixture.connection.close());
  await fixture.request("initialize", { protocolVersion: 1 });
  const created = await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] });
  const sessionId = created.result!.sessionId!;
  return {
    ...fixture,
    sessionId,
    notify(method: string, params: unknown) {
      fixture.input.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
    prompt: () => fixture.request("session/prompt", { sessionId, prompt: text }),
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

const reply = {
  choice: [{ type: "text" as const, text: "reply" }],
  usage: Usage.empty(),
  rawResponse: {},
};

describe("ACP session cancellation", () => {
  it.each([false, true])(
    "settles generation once over v1 (streaming=%s), then permits a new turn",
    async (streaming) => {
      const started = deferred<AbortSignal>();
      let first = true;
      const model: StreamingCompletionModel = {
        ...makeAgent().model,
        capabilities: { ...makeAgent().model.capabilities, streaming },
        async completion(_request, options) {
          if (first) {
            first = false;
            started.resolve(options!.abortSignal!);
            await waitForAbort(options!.abortSignal!);
            throw new Error("late private provider failure");
          }
          return reply;
        },
        async *streamCompletion(request, options) {
          const response = await this.completion(request, options);
          yield { type: "final", response };
        },
      };
      const fixture = await peer(model);
      const pending = fixture.prompt();
      const signal = await started.promise;
      fixture.notify("session/cancel", { sessionId: fixture.sessionId });
      fixture.notify("session/cancel", { sessionId: fixture.sessionId });
      expect((await pending).result).toEqual({ stopReason: "cancelled" });
      expect(signal.aborted).toBe(true);
      expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
      expect(fixture.responses.filter((message) => message.method === "session/update")).toEqual(
        [],
      );
      expect((await fixture.prompt()).result).toEqual({ stopReason: "end_turn" });
      expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
    },
  );

  it("keeps $/cancel_request separate and treats unknown/idle session cancellation as a no-op", async () => {
    const started = deferred<AbortSignal>();
    const gate = deferred();
    const model: CompletionModel = {
      ...makeAgent().model,
      async completion(_request, options) {
        started.resolve(options!.abortSignal!);
        await gate.promise;
        return reply;
      },
    };
    const fixture = await peer(model);
    fixture.notify("session/cancel", { sessionId: "unknown" });
    fixture.notify("session/cancel", { sessionId: fixture.sessionId });
    const pending = fixture.prompt();
    const signal = await started.promise;
    fixture.notify("$/cancel_request", { requestId: 3 });
    // A request behind the notification is a processing barrier for the SDK.
    await fixture.request("authenticate", { methodId: "none" });
    expect(signal.aborted).toBe(false);
    gate.resolve();
    expect((await pending).result).toEqual({ stopReason: "end_turn" });
    expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
  });

  it("cancels before generation starts without aborting the session lifetime", async () => {
    const binding = makeAgent();
    const { session: current } = await session({ sessionFactory: () => binding });
    current.cancel();
    const pending = current.prompt(text);
    current.cancel();
    current.cancel();
    expect(await pending).toBe("cancelled");
    expect(binding.requests).toEqual([]);
    expect(current.context.signal.aborted).toBe(false);
    expect(await current.prompt(text)).toBe("end_turn");
  });

  it.each([false, true])(
    "normalizes AgentRunCancelledError without a notification (streaming=%s)",
    async (streaming) => {
      const binding = makeAgent();
      const model: StreamingCompletionModel = {
        ...binding.model,
        capabilities: { ...binding.model.capabilities, streaming },
        async completion() {
          throw new AgentRunCancelledError([], "private cancellation detail");
        },
        async *streamCompletion() {
          yield {
            type: "error",
            error: new AgentRunCancelledError([], "private cancellation detail"),
          };
        },
      };
      const fixture = await peer(model);
      expect((await fixture.prompt()).result).toEqual({ stopReason: "cancelled" });
      expect(JSON.stringify(fixture.responses)).not.toContain("private cancellation detail");
    },
  );

  it.each(["local", "mcp"] as const)(
    "aborts an active %s tool and drops its late result",
    async (backend) => {
      const started = deferred<AbortSignal>();
      const gate = deferred();
      const call = vi.fn(async (_args, context) => {
        started.resolve(context.abortSignal);
        await gate.promise; // Deliberately ignore abort to exercise quarantine.
        return "late private tool output";
      });
      const tool: Tool = {
        name: "wait",
        definition: () => ({ name: "wait", description: "Wait", parameters: { type: "object" } }),
        call,
      };
      const mcpTool: McpTool = { ...tool, mcp: { serverName: "fixture", remoteName: "wait" } };
      const model: StreamingCompletionModel = {
        ...makeAgent().model,
        capabilities: { ...makeAgent().model.capabilities, streaming: true },
        async *streamCompletion() {
          yield {
            type: "final",
            response: {
              ...reply,
              choice: [{ type: "tool-call", toolCallId: "call", toolName: "wait", input: {} }],
            },
          };
        },
      };
      const dispose = vi.fn();
      const { session: current } = await session({
        sessionFactory: () => ({
          agent: new Agent({
            id: "tool",
            model,
            tools: backend === "local" ? [tool] : [],
            mcpServers: backend === "mcp" ? [{ name: "fixture", tools: [mcpTool] }] : [],
          }),
          dispose,
        }),
      });
      const updates = vi.fn(async () => {});
      const pending = current.prompt(text, updates);
      const signal = await started.promise;
      const before = updates.mock.calls.length;
      current.cancel();
      expect(await pending).toBe("cancelled");
      expect(signal.aborted).toBe(true);
      await expect(current.prompt(text)).rejects.toMatchObject({ kind: "session_busy" });
      const closing = current.close();
      expect(dispose).not.toHaveBeenCalled();
      gate.resolve();
      await closing;
      expect(dispose).toHaveBeenCalledOnce();
      expect(updates).toHaveBeenCalledTimes(before);
      expect(call).toHaveBeenCalledOnce();
      expect(
        await current.memory.load({ scope: { sessionId: current.context.sessionId } }),
      ).toEqual([]);
    },
  );

  it.each(["queued", "late", "rejected"])(
    "invalidates pending callbacks synchronously (%s reply)",
    async (timing) => {
      const started = deferred();
      const approval = deferred<string>();
      let requests!: ReturnType<SessionManager["get"]>["pendingRequests"];
      let callbackSignal!: AbortSignal;
      const execute = vi.fn();
      const model: CompletionModel = {
        ...makeAgent().model,
        async completion() {
          await requests.run((signal) => {
            callbackSignal = signal;
            started.resolve();
            return approval.promise;
          });
          execute();
          return reply;
        },
      };
      const { session: current } = await session({
        sessionFactory: () => ({ agent: new Agent({ id: "callback", model, retries: false }) }),
      });
      const pending = current.prompt(text);
      requests = current.pendingRequests;
      await started.promise;
      if (timing === "queued") approval.resolve("allow_once");
      current.cancel();
      expect(callbackSignal.aborted).toBe(true);
      expect(requests.size).toBe(0);
      expect(await pending).toBe("cancelled");
      if (timing === "late") approval.resolve("allow_once");
      if (timing === "rejected") approval.reject(new Error("late callback failure"));
      await expect(requests.run(async () => "stale dispatch")).rejects.toBeInstanceOf(
        AgentRunCancelledError,
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("drains an in-flight update before settling and suppresses later tool presentation", async () => {
    const gate = deferred();
    const sent = deferred();
    const presentation = vi.fn();
    const model: StreamingCompletionModel = {
      ...makeAgent().model,
      capabilities: { ...makeAgent().model.capabilities, streaming: true },
      async *streamCompletion() {
        yield { type: "tool_call_delta", id: "call", name: "wait" };
        yield { type: "final", response: reply };
      },
    };
    const { session: current } = await session({
      sessionFactory: () => ({
        agent: new Agent({ id: "updates", model }),
        toolPresentation: presentation,
      }),
    });
    const settled = vi.fn();
    const pending = current
      .prompt(text, async () => {
        sent.resolve();
        await gate.promise;
      })
      .then((result) => {
        settled();
        return result;
      });
    await sent.promise;
    current.cancel();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    gate.resolve();
    expect(await pending).toBe("cancelled");
    expect(presentation).not.toHaveBeenCalled();
  });

  it("preserves earlier history and other sessions when cancelling an uncooperative generation", async () => {
    const gate = deferred();
    const started = deferred();
    const binding = makeAgent(async (request) => {
      if (JSON.stringify(request).includes("cancel me")) {
        started.resolve();
        await gate.promise;
      }
    });
    let count = 0;
    const {
      manager,
      session: current,
      id,
    } = await session({
      sessionFactory: () => (count++ === 0 ? binding : makeAgent()),
    });
    await current.prompt(text);
    const old = await current.memory.load({ scope: { sessionId: id } });
    const pending = current.prompt([{ type: "text", text: "cancel me" }]);
    await started.promise;
    current.cancel();
    expect(await pending).toBe("cancelled");
    await expect(current.prompt(text)).rejects.toMatchObject({ kind: "session_busy" });
    const other = await manager.create(process.cwd(), capabilities);
    expect(await manager.get(other).prompt(text)).toBe("end_turn");
    gate.resolve();
    await vi.waitFor(async () => expect(await current.prompt(text)).toBe("end_turn"));
    const history = await current.memory.load({ scope: { sessionId: id } });
    expect(history.slice(0, old.length)).toEqual(old);
    expect(JSON.stringify(history)).not.toContain("cancel me");
  });
});
