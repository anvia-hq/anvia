import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as anvia from "./helpers/imports";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  ExtractorBuilder,
  PipelineBuilder,
  type PipelineOp,
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

describe("PipelineBuilder", () => {
  it("composes sync steps", async () => {
    const op = new PipelineBuilder(z.number())
      .step((value) => value + 1)
      .step((value) => `value:${value}`)
      .build();

    await expect(op.run(2)).resolves.toBe("value:3");
  });

  it("composes async steps", async () => {
    const op = new PipelineBuilder(z.string())
      .step(async (value) => value.trim())
      .step(async (value) => value.toUpperCase())
      .build();

    await expect(op.run(" hello ")).resolves.toBe("HELLO");
  });

  it("uses another pipeline op", async () => {
    const suffix = new PipelineBuilder(z.string()).step((value) => `${value}!`).build();
    const op = new PipelineBuilder(z.string())
      .step((value) => value.toUpperCase())
      .use(suffix)
      .build();

    await expect(op.run("ok")).resolves.toBe("OK!");
  });

  it("batches with a concurrency limit and preserves order", async () => {
    let active = 0;
    let maxActive = 0;
    const op = new PipelineBuilder(z.number())
      .step(async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
      })
      .build();

    await expect(op.batch([3, 1, 2, 4], { concurrency: 2 })).resolves.toEqual([6, 2, 4, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("runs named parallel branches and returns object output", async () => {
    const op = new PipelineBuilder(z.string())
      .parallel({
        upper: new PipelineBuilder(z.string()).step((value) => value.toUpperCase()).build(),
        length: new PipelineBuilder(z.string()).step(async (value) => value.length).build(),
        includesA: new PipelineBuilder(z.string()).step((value) => value.includes("a")).build(),
      })
      .build();

    await expect(op.run("anvia")).resolves.toEqual({
      upper: "ANVIA",
      length: 5,
      includesA: true,
    });
  });

  it("prompts an agent and returns output", async () => {
    const model = new QueueModel([response([AssistantContent.text("answer")])]);
    const agent = new AgentBuilder("test-agent", model).build();
    const op = new PipelineBuilder(z.string())
      .step((value) => `Question: ${value}`)
      .prompt(agent)
      .build();

    await expect(op.run("ping")).resolves.toBe("answer");
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Question: ping" }],
    });
  });

  it("extracts structured data through an extractor", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { priority: "high" })]),
    ]);
    const extractor = new ExtractorBuilder(
      model,
      z.object({ priority: z.enum(["low", "high"]) }),
    ).build();
    const op = new PipelineBuilder(z.string())
      .step((value) => `Extract priority: ${value}`)
      .extract(extractor)
      .build();

    await expect(op.run("urgent incident")).resolves.toEqual({ priority: "high" });
  });

  it("rejects run and batch when a step throws", async () => {
    const op = new PipelineBuilder(z.number())
      .step((value) => {
        if (value === 2) {
          throw new Error("boom");
        }
        return value;
      })
      .build();

    await expect(op.run(2)).rejects.toThrow("boom");
    await expect(op.batch([1, 2, 3], { concurrency: 2 })).rejects.toThrow("boom");
  });

  it("can use a custom pipeline op", async () => {
    const op = new PipelineBuilder(z.number()).use(createPipelineOp((value) => value + 10)).build();

    await expect(op.run(5)).resolves.toBe(15);
  });

  it("exposes an automatic graph", () => {
    const model = new QueueModel([response([AssistantContent.text("answer")])]);
    const agent = new AgentBuilder("support", model).name("Support").build();
    const op = new PipelineBuilder(z.string(), {
      id: "ticket_triage",
      name: "Ticket triage",
      description: "Prepare a support answer.",
      metadata: { owner: "support" },
    })
      .step((value) => value.trim())
      .parallel({
        upper: new PipelineBuilder(z.string()).step((value) => value.toUpperCase()).build(),
        length: new PipelineBuilder(z.string()).step((value) => value.length).build(),
      })
      .prompt(agent)
      .build();

    expect(op.graph()).toMatchObject({
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
    expect(op.graph().edges).toEqual(
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
    const op = new PipelineBuilder(z.number())
      .step((value) => value + 1)
      .step((value) => value * 2)
      .build();

    await expect(
      op.run(2, {
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

  it("does not expose the old helper-first methods at type level", () => {
    const builder = new PipelineBuilder(z.number());
    const op = builder.step((value) => value + 1).build();

    if (unreachable()) {
      // @ts-expect-error - pass a Zod schema instead.
      new PipelineBuilder<number>();
      // @ts-expect-error - pass metadata as the second argument after a Zod schema.
      new PipelineBuilder<number>({ name: "M" });
      // @ts-expect-error - use step(...) instead of map(...).
      builder.map((value: number) => value);
      // @ts-expect-error - use step(...) instead of then(...).
      builder.then((value: number) => value);
      // @ts-expect-error - use use(...) instead of chain(...).
      builder.chain(op);
      // @ts-expect-error - runnable pipelines use run(...).
      op.call(1);
      // @ts-expect-error - construct PipelineBuilder directly instead.
      anvia.pipeline();
      // @ts-expect-error - use PipelineBuilder.parallel({ ... }) instead.
      anvia.parallel();
    }
  });

  it("accepts a Zod schema at construction and infers input type", async () => {
    const op = new PipelineBuilder(z.object({ query: z.string(), limit: z.number() }))
      .step((input) => {
        expectTypeOf(input).toEqualTypeOf<{ query: string; limit: number }>();
        return `${input.query}:${input.limit}`;
      })
      .build();

    await expect(op.run({ query: "search", limit: 3 })).resolves.toBe("search:3");
  });

  it("validates input with a Zod schema at runtime", async () => {
    const op = new PipelineBuilder(z.object({ query: z.string() }))
      .step(({ query }) => query)
      .build();

    await expect(op.run({ query: "ok" })).resolves.toBe("ok");
    await expect(op.run({ query: 42 } as unknown as { query: string })).rejects.toThrow();
  });

  it("applies Zod defaults when parsing input", async () => {
    const op = new PipelineBuilder(z.object({ query: z.string(), limit: z.number().default(10) }))
      .step((input) => {
        expectTypeOf(input).toEqualTypeOf<{ query: string; limit: number }>();
        return `${input.query}:${input.limit}`;
      })
      .build();

    await expect(op.run({ query: "hi" })).resolves.toBe("hi:10");
  });

  it("accepts a Zod schema with metadata as the second argument", async () => {
    const op = new PipelineBuilder(z.object({ x: z.string() }), {
      name: "X Pipeline",
      description: "desc",
      metadata: { owner: "test" },
    })
      .step(({ x }) => x.toUpperCase())
      .build();

    await expect(op.run({ x: "ok" })).resolves.toBe("OK");
    expect(op.name).toBe("X Pipeline");
    expect(op.description).toBe("desc");
    expect(op.metadata).toEqual({ owner: "test" });
  });

  it("accepts metadata as the second argument after a Zod schema", async () => {
    const metadataOnly = new PipelineBuilder(z.string(), { name: "M" })
      .step((s: string) => s)
      .build();

    await expect(metadataOnly.run("hi")).resolves.toBe("hi");
    expect(metadataOnly.name).toBe("M");
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
