import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as publicPipeline from "../src/pipeline";
import {
  Agent,
  AgentRunBlockedError,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineInputGuardrail,
  Pipeline,
  PipelineAgentSuspensionError,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No queued response");
    return response;
  }
}

describe("Pipeline", () => {
  it("validates constructor options", () => {
    const pipeline = new Pipeline({ id: " ticket-triage ", inputSchema: z.string() });
    expect(pipeline.id).toBe("ticket-triage");
    expect(() => new Pipeline({ id: "   ", inputSchema: z.string() })).toThrow(
      "Pipeline id must be a non-empty string",
    );
    expect(() => new Pipeline({ id: 42 as unknown as string, inputSchema: z.string() })).toThrow(
      "Pipeline id must be a string",
    );
    expect(
      () => new Pipeline({ id: "invalid-schema", inputSchema: {} as z.ZodType<string> }),
    ).toThrow("Pipeline inputSchema must be a Zod schema");
  });

  it("runs typed sync and async object stages", async () => {
    const pipeline = new Pipeline({ id: "steps", inputSchema: z.number() })
      .step({ id: "increment", run: ({ input }) => input + 1 })
      .step({ id: "label", run: async ({ input }) => `value:${input}` });

    const result = await pipeline.run({ input: 2, runId: "run_steps" });

    expectTypeOf(result.output).toEqualTypeOf<string>();
    expect(result).toEqual({ runId: "run_steps", output: "value:3" });
  });

  it("requires stable unique stage ids", () => {
    const base = new Pipeline({ id: "ids", inputSchema: z.string() }).step({
      id: "normalize",
      run: ({ input }) => input,
    });
    expect(() => base.step({ id: "normalize", run: ({ input }) => input })).toThrow(
      'Pipeline stage id "normalize" is already registered',
    );
    expect(() =>
      new Pipeline({ id: "reserved", inputSchema: z.string() }).step({
        id: "$input",
        run: ({ input }) => input,
      }),
    ).toThrow("is reserved");
  });

  it("provides one run context to every mapper", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    const pipeline = new Pipeline({ id: "context", inputSchema: z.string() }).step({
      id: "capture",
      run(context) {
        seen.push(context);
        return context.input.toUpperCase();
      },
    });

    await pipeline.run({
      input: "hello",
      runId: "run_context",
      metadata: { tenantId: "acme" },
      abortSignal: controller.signal,
    });

    expect(seen).toEqual([
      {
        input: "hello",
        runId: "run_context",
        pipelineId: "context",
        runMetadata: { tenantId: "acme" },
        abortSignal: controller.signal,
      },
    ]);
  });

  it("uses asynchronous Zod parsing and preserves transformed types", async () => {
    const pipeline = new Pipeline({
      id: "async-schema",
      inputSchema: z.string().transform(async (value) => value.trim().length),
    }).step({
      id: "double",
      run: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<number>();
        return input * 2;
      },
    });

    const result = await pipeline.run({ input: " hi " });
    expect(result.output).toBe(4);
  });

  it("rejects cancellation that occurs during asynchronous input validation", async () => {
    const controller = new AbortController();
    const pipeline = new Pipeline({
      id: "async-schema-abort",
      inputSchema: z.string().transform(async (value) => {
        await delay(5);
        controller.abort("stop");
        return value;
      }),
    });

    await expect(
      pipeline.run({ input: "value", abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("composes a child Pipeline with the same run context", async () => {
    const child = new Pipeline({ id: "suffix", inputSchema: z.string() }).step({
      id: "append",
      run: ({ input, runId, runMetadata }) => `${input}!:${runId}:${runMetadata?.tenant}`,
    });
    const pipeline = new Pipeline({ id: "composed", inputSchema: z.string() })
      .step({ id: "uppercase", run: ({ input }) => input.toUpperCase() })
      .compose({ id: "suffix-boundary", pipeline: child });

    const result = await pipeline.run({
      input: "ok",
      runId: "run_compose",
      metadata: { tenant: "acme" },
    });

    expect(result.output).toBe("OK!:run_compose:acme");
  });

  it("runs named parallel Pipelines and infers their output", async () => {
    const upper = new Pipeline({ id: "upper", inputSchema: z.string() }).step({
      id: "transform",
      run: ({ input }) => input.toUpperCase(),
    });
    const length = new Pipeline({ id: "length", inputSchema: z.string() }).step({
      id: "measure",
      run: async ({ input }) => input.length,
    });
    const pipeline = new Pipeline({ id: "parallel", inputSchema: z.string() }).parallel({
      id: "signals",
      branches: { upper, length },
    });

    const result = await pipeline.run({ input: "anvia" });

    expectTypeOf(result.output).toEqualTypeOf<{ upper: string; length: number }>();
    expect(result.output).toEqual({ upper: "ANVIA", length: 5 });
  });

  it("rejects ambiguous parallel branch ids", () => {
    const branch = new Pipeline({ id: "branch", inputSchema: z.string() });
    const pipeline = new Pipeline({ id: "parallel-ids", inputSchema: z.string() });

    expect(() =>
      pipeline.parallel({
        id: "signals",
        branches: { left: branch, " left ": branch },
      }),
    ).toThrow('Pipeline parallel branch id "left" is already registered');
    expect(() => pipeline.parallel({ id: "signals", branches: { " left ": branch } })).toThrow(
      "must not contain surrounding whitespace",
    );
  });

  it("aborts parallel siblings after the first branch failure", async () => {
    let siblingAborted = false;
    const failing = new Pipeline({ id: "failing", inputSchema: z.string() }).step({
      id: "fail",
      async run() {
        await delay(5);
        throw new Error("branch failed");
      },
    });
    const waiting = new Pipeline({ id: "waiting", inputSchema: z.string() }).step({
      id: "wait",
      run: ({ abortSignal }) =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve("late"), 1_000);
          abortSignal?.addEventListener(
            "abort",
            () => {
              siblingAborted = true;
              clearTimeout(timer);
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    });
    const pipeline = new Pipeline({ id: "parallel-failure", inputSchema: z.string() }).parallel({
      id: "branches",
      branches: { failing, waiting },
    });

    await expect(pipeline.run({ input: "value" })).rejects.toThrow("branch failed");
    expect(siblingAborted).toBe(true);
  });

  it("maps Pipeline values explicitly into Agent requests", async () => {
    const model = new QueueModel([response([AssistantContent.text("answer")])]);
    const agent = new Agent({ id: "support", model });
    const pipeline = new Pipeline({
      id: "agent-stage",
      inputSchema: z.object({ q: z.string() }),
    }).agent({
      id: "answer",
      agent,
      suspension: "reject",
      request: ({ input }) => ({ prompt: `Question: ${input.q}` }),
    });

    const result = await pipeline.run({ input: { q: "ping" } });

    expect(result.output).toBe("answer");
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: "Question: ping",
    });
  });

  it("preserves schema-backed Agent output", async () => {
    const agent = new Agent({
      id: "typed-agent",
      model: new QueueModel([response([AssistantContent.text('{"answer":"typed"}')])]),
      outputSchema: z.object({ answer: z.string() }),
    });
    const pipeline = new Pipeline({ id: "typed-agent-stage", inputSchema: z.string() }).agent({
      id: "answer",
      agent,
      suspension: "reject",
      request: ({ input }) => ({ prompt: input }),
    });

    const result = await pipeline.run({ input: "question" });
    expectTypeOf(result.output).toEqualTypeOf<{ answer: string }>();
    expect(result.output).toEqual({ answer: "typed" });
  });

  it("explicitly rejects and cancels approval-required Agent stages", async () => {
    let observedError: unknown;
    const guardedTool = createTool({
      name: "guarded",
      description: "Run a guarded operation",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute: () => "approved",
    });
    const agent = new Agent({
      id: "approval-agent",
      model: new QueueModel([response([AssistantContent.toolCall("call_1", "guarded", {})])]),
      tools: [guardedTool],
      observability: {
        observers: {
          test: createObserver({
            startRun() {
              return {
                end() {},
                error({ error }) {
                  observedError = error;
                },
              };
            },
          }),
        },
      },
    });
    const pipeline = new Pipeline({ id: "approval-pipeline", inputSchema: z.string() }).agent({
      id: "guarded-agent",
      agent,
      suspension: "reject",
      request: ({ input }) => ({ prompt: input }),
    });

    const error = await pipeline.run({ input: "run guarded tool" }).catch((failure) => failure);

    expect(error).toBeInstanceOf(PipelineAgentSuspensionError);
    expect(error.result.status).toBe("suspended");
    expect(observedError).toBeUndefined();
  });

  it("preserves blocked Agent errors", async () => {
    const inputGuardrail = defineInputGuardrail({
      id: "block",
      check(_context, { block }) {
        return block({ reason: "blocked" });
      },
    });
    const agent = new Agent({
      id: "blocked-agent",
      model: new QueueModel([]),
      guardrails: defineGuardrailPolicy({ id: "blocked-policy", input: [inputGuardrail] }),
    });
    const pipeline = new Pipeline({ id: "blocked-pipeline", inputSchema: z.string() }).agent({
      id: "blocked",
      agent,
      suspension: "reject",
      request: ({ input }) => ({ prompt: input }),
    });
    await expect(pipeline.run({ input: "stop" })).rejects.toBeInstanceOf(AgentRunBlockedError);
  });

  it("maps Pipeline values explicitly into extraction text", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { priority: "high" })]),
    ]);
    const pipeline = new Pipeline({
      id: "extractor-stage",
      inputSchema: z.object({ note: z.string() }),
    }).extract({
      id: "priority",
      model,
      outputSchema: z.object({ priority: z.enum(["low", "high"]) }),
      text: ({ input }) => `Extract priority: ${input.note}`,
    });

    const result = await pipeline.run({ input: { note: "urgent" } });
    expect(result.output).toEqual({ priority: "high" });
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      content: "Extract priority: urgent",
    });
  });

  it("produces hierarchical graphs and events for composed and parallel children", async () => {
    const child = new Pipeline({ id: "child", inputSchema: z.string() }).step({
      id: "shared",
      run: ({ input }) => input.toUpperCase(),
    });
    const pipeline = new Pipeline({ id: "graph", inputSchema: z.string() })
      .compose({ id: "nested", pipeline: child })
      .parallel({ id: "fanout", branches: { left: child, right: child } });
    const paths: string[][] = [];

    await pipeline.run({
      input: "value",
      runId: "run_graph",
      observer: {
        onEvent(event) {
          if (event.type === "stage_started") paths.push([...event.path]);
          expect(event.runId).toBe("run_graph");
          expect(event.pipelineId).toBe("graph");
        },
      },
    });

    expect(paths).toEqual([
      ["nested"],
      ["nested", "shared"],
      ["fanout"],
      ["fanout", "left"],
      ["fanout", "right"],
      ["fanout", "left", "shared"],
      ["fanout", "right", "shared"],
    ]);
    expect(pipeline.graph().nodes.map((node) => node.path)).toEqual([
      ["$input"],
      ["nested"],
      ["nested", "shared"],
      ["fanout"],
      ["fanout", "left"],
      ["fanout", "left", "shared"],
      ["fanout", "right"],
      ["fanout", "right", "shared"],
      ["$output"],
    ]);
    expect(pipeline.graph().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: ["$input"], target: ["nested"] }),
        expect.objectContaining({ source: ["nested"], target: ["nested", "shared"] }),
        expect.objectContaining({ source: ["nested", "shared"], target: ["fanout"] }),
        expect.objectContaining({ source: ["fanout"], target: ["fanout", "left"] }),
      ]),
    );
  });

  it("isolates observer errors unless strict delivery is requested", async () => {
    const pipeline = new Pipeline({ id: "observer", inputSchema: z.number() }).step({
      id: "increment",
      run: ({ input }) => input + 1,
    });
    const observer = { onEvent: () => Promise.reject(new Error("observer failed")) };

    await expect(pipeline.run({ input: 1, observer })).resolves.toMatchObject({ output: 2 });
    await expect(pipeline.run({ input: 1, observer, failOnObserverError: true })).rejects.toThrow(
      "observer failed",
    );
  });

  it("returns ordered settled batch entries with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const pipeline = new Pipeline({ id: "batch", inputSchema: z.number() }).step({
      id: "double",
      async run({ input }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active -= 1;
        if (input === 2) throw new Error("boom");
        return input * 2;
      },
    });

    const results = await pipeline.runBatch({ inputs: [3, 2, 1], concurrency: 2 });

    expect(results.map((result) => result.status)).toEqual(["completed", "failed", "completed"]);
    expect(results[0]).toMatchObject({ status: "completed", output: 6 });
    expect(results[1]).toMatchObject({ status: "failed", error: expect.any(Error) });
    expect(results[2]).toMatchObject({ status: "completed", output: 2 });
    expect(maxActive).toBe(2);
  });

  it("settles input validation failures independently", async () => {
    const pipeline = new Pipeline({ id: "validated-batch", inputSchema: z.number().positive() });

    const results = await pipeline.runBatch({ inputs: [1, -1, 2], concurrency: 2 });

    expect(results.map((result) => result.status)).toEqual(["completed", "failed", "completed"]);
  });

  it("stops scheduling and rejects the whole batch on external cancellation", async () => {
    const controller = new AbortController();
    let started = 0;
    const pipeline = new Pipeline({ id: "cancelled-batch", inputSchema: z.number() }).step({
      id: "wait",
      run: ({ input, abortSignal }) =>
        new Promise<number>((resolve, reject) => {
          started += 1;
          const timer = setTimeout(() => resolve(input), 1_000);
          abortSignal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    });

    const batch = pipeline.runBatch({
      inputs: [1, 2, 3, 4],
      concurrency: 2,
      abortSignal: controller.signal,
    });
    await delay(5);
    controller.abort("stop");

    await expect(batch).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toBe(2);
  });

  it("keeps fluent branches immutable", async () => {
    const base = new Pipeline({ id: "immutable", inputSchema: z.number() }).step({
      id: "increment",
      run: ({ input }) => input + 1,
    });
    const doubled = base.step({ id: "double", run: ({ input }) => input * 2 });
    const labeled = base.step({ id: "label", run: ({ input }) => `value:${input}` });

    expect((await base.run({ input: 2 })).output).toBe(3);
    expect((await doubled.run({ input: 2 })).output).toBe(6);
    expect((await labeled.run({ input: 2 })).output).toBe("value:3");
    expect(base.graph().nodes.map((node) => node.id)).toEqual(["$input", "increment", "$output"]);
  });

  it("removes positional and arbitrary operation APIs", () => {
    const pipeline = new Pipeline({ id: "types", inputSchema: z.number() });
    expect("use" in pipeline).toBe(false);
    expect("batch" in pipeline).toBe(false);
    expect("PipelineOp" in publicPipeline).toBe(false);

    if (unreachable()) {
      // @ts-expect-error - arbitrary PipelineOp composition was removed.
      type RemovedPipelineOp = import("../src/pipeline").PipelineOp;
      // @ts-expect-error - step requires one options object.
      pipeline.step((input: number) => input + 1);
      // @ts-expect-error - run requires one options object.
      pipeline.run(1);
      // @ts-expect-error - batch was replaced by runBatch.
      pipeline.batch([1], { concurrency: 1 });
      // @ts-expect-error - arbitrary operation composition was removed.
      pipeline.use({ run: (input: number) => input });
      // @ts-expect-error - parallel requires stage metadata and branches.
      pipeline.parallel({ branch: pipeline });
      // @ts-expect-error - Agent stages require a request mapper and approval behavior.
      pipeline.agent(new Agent({ id: "old", model: new QueueModel([]) }));
      const removed = undefined as unknown as RemovedPipelineOp;
      void removed;
    }
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return { choice, usage: Usage.empty(), rawResponse: {} };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function unreachable(): boolean {
  return false;
}
