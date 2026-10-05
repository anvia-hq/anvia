import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  agentEvalTarget,
  AssistantContent,
  type AgentResponse,
  type AgentRunOptions,
  type CompletionModel,
  type CompletionResponse,
  createTool,
  exactMatch,
  runEvalSuite,
  Usage,
} from "./helpers/imports";
import { abortable, EvalTimeoutError } from "../src/evals/execution";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function completion(choice: CompletionResponse["choice"]): CompletionResponse {
  return { choice, usage: Usage.empty(), rawResponse: {} };
}

function response(output = "ok"): AgentResponse<string> {
  return {
    type: "response",
    output,
    text: output,
    runId: "run",
    messages: [],
    usage: Usage.empty(),
  };
}

function modelFixture(choices: CompletionResponse["choice"][] = []) {
  const started = deferred<void>();
  const pending = deferred<void>();
  const stopped = deferred<void>();
  const signals: Array<AbortSignal | undefined> = [];
  let active = 0;
  const model: CompletionModel = {
    provider: "test",
    modelId: "test",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    async completion(_request, options) {
      signals.push(options?.abortSignal);
      started.resolve();
      const choice = choices.shift();
      if (choice !== undefined) return completion(choice);
      active += 1;
      pending.resolve();
      return new Promise<CompletionResponse>((_resolve, reject) => {
        const signal = options?.abortSignal;
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          active -= 1;
          stopped.resolve();
          reject(signal?.reason);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
  return {
    model,
    started,
    pending,
    stopped,
    signals,
    get active() {
      return active;
    },
  };
}

const testCase = { id: "case", input: "hello", expected: "ok" };

function approvalFixture(complete = true) {
  const fixture = modelFixture([
    [AssistantContent.toolCall("call", "guarded", {})],
    ...(complete ? [[AssistantContent.text("done")]] : []),
  ]);
  const guarded = createTool({
    name: "guarded",
    description: "Guarded operation",
    inputSchema: z.object({}),
    requiresApproval: true,
    execute: () => "approved",
  });
  return {
    ...fixture,
    agent: new Agent({ id: "approval", model: fixture.model, tools: [guarded] }),
    get active() {
      return fixture.active;
    },
  };
}

function listenerBalance(signal: AbortSignal) {
  const add = vi.spyOn(signal, "addEventListener");
  const remove = vi.spyOn(signal, "removeEventListener");
  return () => {
    const registered = new Set(
      add.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener),
    );
    for (const [type, listener] of remove.mock.calls)
      if (type === "abort") registered.delete(listener);
    return registered.size;
  };
}

describe("agent eval cancellation", () => {
  it("times out cooperative generation with a timeout error and no active operation", async () => {
    const fixture = modelFixture();
    const result = await runEvalSuite({
      name: "timeout",
      cases: [testCase],
      metrics: [exactMatch()],
      caseTimeoutMs: 30,
      target: agentEvalTarget<string>({
        agent: new Agent({ id: "timeout", model: fixture.model }),
        request: ({ input }) => ({ prompt: input }),
      }),
    });
    await fixture.stopped.promise;
    expect(result.results[0]?.targetError).toBeInstanceOf(EvalTimeoutError);
    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "invalid",
      kind: "timeout",
    });
    expect(fixture.active).toBe(0);
  });

  it("preserves the suite reason and stops cooperative provider work", async () => {
    const fixture = modelFixture();
    const controller = new AbortController();
    const reason = new Error("suite-stop");
    const operation = runEvalSuite({
      name: "suite-abort",
      cases: [testCase],
      metrics: [exactMatch()],
      signal: controller.signal,
      target: agentEvalTarget<string>({
        agent: new Agent({ id: "suite", model: fixture.model }),
        request: ({ input }) => ({ prompt: input }),
      }),
    });
    const rejection = expect(operation).rejects.toBe(reason);
    await fixture.started.promise;
    controller.abort(reason);
    await rejection;
    await fixture.stopped.promise;
    expect(fixture.active).toBe(0);
  });

  it.each(["case", "request"] as const)(
    "composes %s cancellation without mutating caller settings",
    async (source) => {
      const caseController = new AbortController();
      const requestController = new AbortController();
      const caseBalance = listenerBalance(caseController.signal);
      const requestBalance = listenerBalance(requestController.signal);
      const started = deferred<void>();
      const reason = new Error(`${source}-stop`);
      const request = Object.freeze({ prompt: "hello", abortSignal: requestController.signal });
      let effective!: AbortSignal;
      const target = agentEvalTarget<string>({
        agent: {
          generate(settings) {
            effective = settings.abortSignal!;
            started.resolve();
            return new Promise((_resolve, reject) =>
              effective.addEventListener("abort", () => reject(effective.reason), { once: true }),
            );
          },
        },
        request: () => request,
      });
      const operation = target("hello", testCase, { signal: caseController.signal });
      const rejection = expect(operation).rejects.toBe(reason);
      await started.promise;
      (source === "case" ? caseController : requestController).abort(reason);
      await rejection;
      expect(effective.reason).toBe(reason);
      (source === "case" ? requestController : caseController).abort("later");
      expect(effective.reason).toBe(reason);
      expect(request.abortSignal).toBe(requestController.signal);
      expect(caseBalance()).toBe(0);
      expect(requestBalance()).toBe(0);
    },
  );

  it("rejects pre-aborted case and request contexts before generation with a successful control", async () => {
    const controller = new AbortController();
    const reason = new Error("pre-stop");
    controller.abort(reason);
    let requests = 0;
    let calls = 0;
    const target = agentEvalTarget<string>({
      agent: {
        async generate() {
          calls += 1;
          return response();
        },
      },
      request: () => {
        requests += 1;
        return { prompt: "hello" };
      },
    });
    await expect(target("hello", testCase, { signal: controller.signal })).rejects.toBe(reason);
    expect(requests).toBe(0);
    expect(calls).toBe(0);
    const requestTarget = agentEvalTarget<string>({
      agent: {
        async generate() {
          calls += 1;
          return response();
        },
      },
      request: () => ({ prompt: "hello", abortSignal: controller.signal }),
    });
    await expect(requestTarget("hello", testCase)).rejects.toBe(reason);
    expect(calls).toBe(0);
    expect((await target("hello", testCase)).output).toBe("ok");
    expect(calls).toBe(1);
  });

  it("completes approval with effective signals on initial and resumed calls", async () => {
    const fixture = approvalFixture();
    const caseController = new AbortController();
    const requestController = new AbortController();
    const caseBalance = listenerBalance(caseController.signal);
    const requestBalance = listenerBalance(requestController.signal);
    const settings: AgentRunOptions<string>[] = [];
    const target = agentEvalTarget<string>({
      agent: {
        generate(input) {
          settings.push(input);
          return fixture.agent.generate(input);
        },
      },
      request: () => ({ prompt: "hello", abortSignal: requestController.signal, maxTurns: 2 }),
      interactions: { respond: () => ({ type: "tool-approval", approved: true }) },
    });
    expect((await target("hello", testCase, { signal: caseController.signal })).output).toBe(
      "done",
    );
    expect(settings).toHaveLength(2);
    expect(settings[0]?.abortSignal).toBe(settings[1]?.abortSignal);
    expect(settings[0]?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(fixture.signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(caseBalance()).toBe(0);
    expect(requestBalance()).toBe(0);
    caseController.abort("after-success");
    expect(settings[0]?.abortSignal?.aborted).toBe(false);
  });

  it("stops provider work during a resumed approval phase", async () => {
    const fixture = approvalFixture(false);
    const controller = new AbortController();
    const resumed = deferred<void>();
    const reason = new Error("resume-stop");
    let generations = 0;
    const target = agentEvalTarget<string>({
      agent: {
        generate(input) {
          generations += 1;
          const operation = fixture.agent.generate(input);
          if (generations === 2) resumed.resolve();
          return operation;
        },
      },
      request: () => ({ prompt: "hello", maxTurns: 2 }),
      interactions: { respond: () => ({ type: "tool-approval", approved: true }) },
    });
    const operation = target("hello", testCase, { signal: controller.signal });
    const rejection = expect(operation).rejects.toBe(reason);
    await resumed.promise;
    await fixture.pending.promise;
    expect(fixture.signals).toHaveLength(2);
    controller.abort(reason);
    await rejection;
    await fixture.stopped.promise;
    expect(generations).toBe(2);
    expect(fixture.signals[1]?.aborted).toBe(true);
    expect(fixture.active).toBe(0);
  });

  it("rejects a pending responder and never resumes after it is released", async () => {
    const fixture = approvalFixture();
    const controller = new AbortController();
    const reason = new Error("responder-stop");
    const entered = deferred<void>();
    const responder = deferred<{ type: "tool-approval"; approved: boolean }>();
    const target = agentEvalTarget<string>({
      agent: fixture.agent,
      request: () => ({ prompt: "hello", maxTurns: 2 }),
      interactions: {
        respond() {
          entered.resolve();
          return responder.promise;
        },
      },
    });
    const operation = target("hello", testCase, { signal: controller.signal });
    const rejection = expect(operation).rejects.toBe(reason);
    await entered.promise;
    controller.abort(reason);
    await rejection;
    responder.resolve({ type: "tool-approval", approved: true });
    await Promise.resolve();
    expect(fixture.signals).toHaveLength(1);
    expect(
      (
        await agentEvalTarget<string>({
          agent: {
            async generate() {
              return response("control");
            },
          },
          request: () => ({ prompt: "hello" }),
        })("hello", testCase)
      ).output,
    ).toBe("control");
  });

  it("observes a late request rejection without starting generation", async () => {
    const controller = new AbortController();
    const reason = new Error("request-callback-stop");
    const request = deferred<AgentRunOptions<string>>();
    let calls = 0;
    const target = agentEvalTarget<string>({
      agent: {
        async generate() {
          calls += 1;
          return response();
        },
      },
      request: () => request.promise,
    });
    const operation = target("hello", testCase, { signal: controller.signal });
    const rejection = expect(operation).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    request.reject(new Error("late-callback-error"));
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(
      (
        await agentEvalTarget<string>({
          agent: {
            async generate() {
              calls += 1;
              return response();
            },
          },
          request: () => ({ prompt: "hello" }),
        })("hello", testCase)
      ).output,
    ).toBe("ok");
    expect(calls).toBe(1);
  });

  it("rejects pending output mapping and disposes links before a late result", async () => {
    const caseController = new AbortController();
    const requestController = new AbortController();
    const caseBalance = listenerBalance(caseController.signal);
    const requestBalance = listenerBalance(requestController.signal);
    const entered = deferred<void>();
    const mapped = deferred<string>();
    const reason = new Error("output-stop");
    const target = agentEvalTarget<string, string, string>({
      agent: {
        async generate() {
          return response();
        },
      },
      request: () => ({ prompt: "hello", abortSignal: requestController.signal }),
      output: () => {
        entered.resolve();
        return mapped.promise;
      },
    });
    const operation = target("hello", testCase, { signal: caseController.signal });
    const rejection = expect(operation).rejects.toBe(reason);
    await entered.promise;
    requestController.abort(reason);
    await rejection;
    expect(caseBalance()).toBe(0);
    expect(requestBalance()).toBe(0);
    mapped.resolve("late");
    expect(
      await agentEvalTarget<string, string, string>({
        agent: {
          async generate() {
            return response();
          },
        },
        request: () => ({ prompt: "hello" }),
        output: ({ response }) => response.output,
      })("hello", testCase),
    ).toBe("ok");
  });

  it.each(["request", "generation", "output"] as const)(
    "guards synchronous cancellation in the %s phase",
    async (phase) => {
      const controller = new AbortController();
      const reason = new Error(`${phase}-stop`);
      let calls = 0;
      let outputs = 0;
      const target = agentEvalTarget<string, string, string>({
        agent: {
          async generate() {
            calls += 1;
            if (phase === "generation") controller.abort(reason);
            return response();
          },
        },
        request: () => {
          if (phase === "request") controller.abort(reason);
          return { prompt: "hello" };
        },
        output: ({ response }) => {
          outputs += 1;
          if (phase === "output") controller.abort(reason);
          return response.output;
        },
      });
      await expect(target("hello", testCase, { signal: controller.signal })).rejects.toBe(reason);
      expect(calls).toBe(phase === "request" ? 0 : 1);
      expect(outputs).toBe(phase === "output" ? 1 : 0);
      expect(await target("hello", testCase)).toBe("ok");
    },
  );

  it("disposes composition links on provider and output failures", async () => {
    for (const phase of ["generation", "output"] as const) {
      const caseController = new AbortController();
      const requestController = new AbortController();
      const caseBalance = listenerBalance(caseController.signal);
      const requestBalance = listenerBalance(requestController.signal);
      const reason = new Error(`${phase}-failed`);
      const target = agentEvalTarget<string, string, string>({
        agent: {
          async generate() {
            if (phase === "generation") throw reason;
            return response();
          },
        },
        request: () => ({ prompt: "hello", abortSignal: requestController.signal }),
        output: () => {
          throw reason;
        },
      });
      await expect(target("hello", testCase, { signal: caseController.signal })).rejects.toBe(
        reason,
      );
      expect(caseBalance()).toBe(0);
      expect(requestBalance()).toBe(0);
    }
  });
});

describe("evaluation operation ownership", () => {
  it("observes a pre-aborted operation rejection and preserves its abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("pre-stop");
    controller.abort(reason);
    await expect(abortable(controller.signal, Promise.reject(new Error("late")))).rejects.toBe(
      reason,
    );
    expect(await abortable(new AbortController().signal, Promise.resolve("ok"))).toBe("ok");
  });

  it("removes its listener before a noncooperative operation settles", async () => {
    const controller = new AbortController();
    const balance = listenerBalance(controller.signal);
    const operation = deferred<string>();
    const reason = new Error("stop");
    const waiting = abortable(controller.signal, operation.promise);
    const rejection = expect(waiting).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(balance()).toBe(0);
    operation.resolve("late");
    expect(await abortable(new AbortController().signal, Promise.resolve("ok"))).toBe("ok");
  });
});
