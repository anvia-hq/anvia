import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as anvia from "./helpers/imports";
import {
  Agent,
  AgentRunCancelledError,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createObserver,
  createTool,
  Extractor,
  Pipeline,
  type PipelineOp,
  TestAgentBuilder,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

describe("Pipeline", () => {
  it("validates and normalizes constructor options", () => {
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

  it("composes sync steps", async () => {
    const pipeline = new Pipeline({ id: "sync-steps", inputSchema: z.number() })
      .step((value) => value + 1)
      .step((value) => `value:${value}`);

    expect(pipeline).toBeInstanceOf(Pipeline);
    expectTypeOf(pipeline).toEqualTypeOf<Pipeline<number, string>>();
    await expect(pipeline.run(2)).resolves.toBe("value:3");
  });

  it("composes async steps", async () => {
    const pipeline = new Pipeline({ id: "async-steps", inputSchema: z.string() })
      .step(async (value) => value.trim())
      .step(async (value) => value.toUpperCase());

    await expect(pipeline.run(" hello ")).resolves.toBe("HELLO");
  });

  it("uses another pipeline op", async () => {
    const suffix = new Pipeline({ id: "suffix", inputSchema: z.string() }).step(
      (value) => `${value}!`,
    );
    const pipeline = new Pipeline({ id: "composed", inputSchema: z.string() })
      .step((value) => value.toUpperCase())
      .use(suffix);

    expect(pipeline).toBeInstanceOf(Pipeline);
    expectTypeOf(pipeline).toEqualTypeOf<Pipeline<string, string>>();
    await expect(pipeline.run("ok")).resolves.toBe("OK!");
  });

  it("batches with a concurrency limit and preserves order", async () => {
    let active = 0;
    let maxActive = 0;
    const pipeline = new Pipeline({ id: "batch", inputSchema: z.number() }).step(async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    await expect(pipeline.batch([3, 1, 2, 4], { concurrency: 2 })).resolves.toEqual([6, 2, 4, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("runs named parallel branches and returns object output", async () => {
    const pipeline = new Pipeline({ id: "parallel", inputSchema: z.string() }).parallel({
      upper: new Pipeline({ id: "uppercase", inputSchema: z.string() }).step((value) =>
        value.toUpperCase(),
      ),
      length: new Pipeline({ id: "length", inputSchema: z.string() }).step(
        async (value) => value.length,
      ),
      includesA: new Pipeline({ id: "includes-a", inputSchema: z.string() }).step((value) =>
        value.includes("a"),
      ),
    });

    expect(pipeline).toBeInstanceOf(Pipeline);
    expectTypeOf(pipeline).toEqualTypeOf<
      Pipeline<string, { upper: string; length: number; includesA: boolean }>
    >();
    await expect(pipeline.run("anvia")).resolves.toEqual({
      upper: "ANVIA",
      length: 5,
      includesA: true,
    });
  });

  it("prompts an agent and returns output", async () => {
    const model = new QueueModel([response([AssistantContent.text("answer")])]);
    const agent = new TestAgentBuilder("test-agent", model).build();
    const pipeline = new Pipeline({ id: "agent-stage", inputSchema: z.string() })
      .step((value) => `Question: ${value}`)
      .agent(agent);

    expect(pipeline).toBeInstanceOf(Pipeline);
    expectTypeOf(pipeline).toEqualTypeOf<Pipeline<string, string>>();
    await expect(pipeline.run("ping")).resolves.toBe("answer");
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Question: ping" }],
    });
  });

  it("cancels an agent stage that requires tool approval", async () => {
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
      observers: [
        createObserver({
          startRun() {
            return {
              end() {},
              error({ error }) {
                observedError = error;
              },
            };
          },
        }),
      ],
    });
    const pipeline = new Pipeline({ id: "approval-pipeline", inputSchema: z.string() }).agent(
      agent,
    );

    await expect(pipeline.run("run guarded tool")).rejects.toThrow(
      "Pipeline agent stages cannot suspend for tool approval",
    );
    expect(observedError).toBeInstanceOf(AgentRunCancelledError);
  });

  it("extracts structured data through an extractor", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { priority: "high" })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ priority: z.enum(["low", "high"]) }),
    });
    const pipeline = new Pipeline({ id: "extractor-stage", inputSchema: z.string() })
      .step((value) => `Extract priority: ${value}`)
      .extract(extractor);

    expect(pipeline).toBeInstanceOf(Pipeline);
    expectTypeOf(pipeline).toEqualTypeOf<Pipeline<string, { priority: "low" | "high" }>>();
    await expect(pipeline.run("urgent incident")).resolves.toEqual({ priority: "high" });
  });

  it("rejects run and batch when a step throws", async () => {
    const pipeline = new Pipeline({ id: "errors", inputSchema: z.number() }).step((value) => {
      if (value === 2) {
        throw new Error("boom");
      }
      return value;
    });

    await expect(pipeline.run(2)).rejects.toThrow("boom");
    await expect(pipeline.batch([1, 2, 3], { concurrency: 2 })).rejects.toThrow("boom");
  });

  it("can use a custom pipeline op", async () => {
    const pipeline = new Pipeline({ id: "custom-op", inputSchema: z.number() }).use(
      createPipelineOp((value) => value + 10),
    );

    await expect(pipeline.run(5)).resolves.toBe(15);
  });

  it("keeps fluent branching immutable", async () => {
    const base = new Pipeline({ id: "immutable", inputSchema: z.number() }).step(
      (value) => value + 1,
    );
    const doubled = base.step((value) => value * 2);
    const labeled = base.step((value) => `value:${value}`);

    await expect(base.run(2)).resolves.toBe(3);
    await expect(doubled.run(2)).resolves.toBe(6);
    await expect(labeled.run(2)).resolves.toBe("value:3");
    expect(base.graph().nodes.map((node) => node.kind)).toEqual(["input", "step", "output"]);
    expect(doubled.graph().nodes.map((node) => node.kind)).toEqual([
      "input",
      "step",
      "step",
      "output",
    ]);
  });

  it("exposes an automatic graph", () => {
    const model = new QueueModel([response([AssistantContent.text("answer")])]);
    const agent = new TestAgentBuilder("support", model).name("Support").build();
    const pipeline = new Pipeline({
      id: "ticket_triage",
      inputSchema: z.string(),
      name: "Ticket triage",
      description: "Prepare a support answer.",
      metadata: { owner: "support" },
    })
      .step((value) => value.trim())
      .parallel({
        upper: new Pipeline({ id: "upper", inputSchema: z.string() }).step((value) =>
          value.toUpperCase(),
        ),
        length: new Pipeline({ id: "length", inputSchema: z.string() }).step(
          (value) => value.length,
        ),
      })
      .agent(agent);

    expect(pipeline.graph()).toMatchObject({
      id: "ticket_triage",
      name: "Ticket triage",
      description: "Prepare a support answer.",
      metadata: { owner: "support" },
      nodes: [
        { id: "input", kind: "input", label: "Input" },
        { kind: "step", label: "Step 1" },
        { kind: "parallel", label: "2 parallel branches" },
        { kind: "branch", label: "upper", branchKey: "upper" },
        { kind: "branch", label: "length", branchKey: "length" },
        { kind: "agent", label: "Support", agentId: "support", agentName: "Support" },
        { id: "output", kind: "output", label: "Output" },
      ],
    });
    expect(pipeline.graph().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "input", target: "step_1" }),
        expect.objectContaining({ source: "step_1", target: "parallel_2" }),
        expect.objectContaining({ source: "parallel_2", target: "branch_3" }),
        expect.objectContaining({ source: "parallel_2", target: "branch_4" }),
        expect.objectContaining({ source: "branch_3", target: "agent_5" }),
        expect.objectContaining({ source: "branch_4", target: "agent_5" }),
        expect.objectContaining({ source: "agent_5", target: "output" }),
      ]),
    );
  });

  it("emits pipeline stage run events without changing output", async () => {
    const events: string[] = [];
    const pipeline = new Pipeline({ id: "observed", inputSchema: z.number() })
      .step((value) => value + 1)
      .step((value) => value * 2);

    await expect(
      pipeline.run(2, {
        observer: {
          onEvent(event) {
            events.push(`${event.type}:${event.node.id}`);
          },
        },
      }),
    ).resolves.toBe(6);
    expect(events).toEqual([
      "stage_started:step_1",
      "stage_completed:step_1",
      "stage_started:step_2",
      "stage_completed:step_2",
    ]);
  });

  it("exposes only the direct fluent API at type level", () => {
    const pipeline = new Pipeline({ id: "types", inputSchema: z.number() });
    const stepped = pipeline.step((value) => value + 1);

    expect(stepped).toBeInstanceOf(Pipeline);
    expect("build" in pipeline).toBe(false);

    if (unreachable()) {
      // @ts-expect-error - Pipeline requires an options object.
      new Pipeline<number>();
      // @ts-expect-error - Pipeline requires id and inputSchema.
      new Pipeline<number>({ name: "M" });
      // @ts-expect-error - the executor/graph constructor is internal.
      new Pipeline<number, number>(async (value) => value, pipeline.graph());
      // @ts-expect-error - use step(...) instead of map(...).
      pipeline.map((value: number) => value);
      // @ts-expect-error - use step(...) instead of then(...).
      pipeline.then((value: number) => value);
      // @ts-expect-error - use use(...) instead of chain(...).
      pipeline.chain(stepped);
      // @ts-expect-error - pipelines use run(...).
      pipeline.call(1);
      // @ts-expect-error - Pipeline has no build phase.
      pipeline.build();
      // @ts-expect-error - construct Pipeline directly instead.
      anvia.pipeline();
      // @ts-expect-error - use pipeline.parallel({ ... }) instead.
      anvia.parallel();
    }
  });

  it("accepts a Zod schema at construction and infers input type", async () => {
    const pipeline = new Pipeline({
      id: "object-input",
      inputSchema: z.object({ query: z.string(), limit: z.number() }),
    }).step((input) => {
      expectTypeOf(input).toEqualTypeOf<{ query: string; limit: number }>();
      return `${input.query}:${input.limit}`;
    });

    await expect(pipeline.run({ query: "search", limit: 3 })).resolves.toBe("search:3");
  });

  it("validates input with a Zod schema at runtime", async () => {
    const pipeline = new Pipeline({
      id: "validated-input",
      inputSchema: z.object({ query: z.string() }),
    }).step(({ query }) => query);

    await expect(pipeline.run({ query: "ok" })).resolves.toBe("ok");
    await expect(pipeline.run({ query: 42 } as unknown as { query: string })).rejects.toThrow();
  });

  it("preserves distinct Zod input and transformed output types", async () => {
    let parseCount = 0;
    const pipeline = new Pipeline({
      id: "transformed-input",
      inputSchema: z.string().transform((value) => {
        parseCount += 1;
        return value.trim().length;
      }),
    }).step((length) => {
      expectTypeOf(length).toEqualTypeOf<number>();
      return length * 2;
    });

    expectTypeOf(pipeline).toEqualTypeOf<Pipeline<string, number>>();
    await expect(pipeline.run(" hi ")).resolves.toBe(4);
    expect(parseCount).toBe(1);
  });

  it("applies Zod defaults when parsing input", async () => {
    const pipeline = new Pipeline({
      id: "defaults",
      inputSchema: z.object({ query: z.string(), limit: z.number().default(10) }),
    }).step((input) => {
      expectTypeOf(input).toEqualTypeOf<{ query: string; limit: number }>();
      return `${input.query}:${input.limit}`;
    });

    await expect(pipeline.run({ query: "hi" })).resolves.toBe("hi:10");
  });

  it("accepts pipeline metadata through constructor options", async () => {
    const pipeline = new Pipeline({
      id: "metadata",
      inputSchema: z.object({ x: z.string() }),
      name: "X Pipeline",
      description: "desc",
      metadata: { owner: "test" },
    }).step(({ x }) => x.toUpperCase());

    await expect(pipeline.run({ x: "ok" })).resolves.toBe("OK");
    expect(pipeline.name).toBe("X Pipeline");
    expect(pipeline.description).toBe("desc");
    expect(pipeline.metadata).toEqual({ owner: "test" });
  });
});

function unreachable(): boolean {
  return false;
}

function createPipelineOp<Input, Output>(
  run: (input: Input) => Output | Promise<Output>,
): PipelineOp<Input, Output> {
  return { run };
}
