import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as anvia from "../src/index";
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
} from "../src/index";

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
    const op = new PipelineBuilder<number>()
      .step((value) => value + 1)
      .step((value) => `value:${value}`)
      .build();

    await expect(op.run(2)).resolves.toBe("value:3");
  });

  it("composes async steps", async () => {
    const op = new PipelineBuilder<string>()
      .step(async (value) => value.trim())
      .step(async (value) => value.toUpperCase())
      .build();

    await expect(op.run(" hello ")).resolves.toBe("HELLO");
  });

  it("uses another pipeline op", async () => {
    const suffix = new PipelineBuilder<string>().step((value) => `${value}!`).build();
    const op = new PipelineBuilder<string>()
      .step((value) => value.toUpperCase())
      .use(suffix)
      .build();

    await expect(op.run("ok")).resolves.toBe("OK!");
  });

  it("batches with a concurrency limit and preserves order", async () => {
    let active = 0;
    let maxActive = 0;
    const op = new PipelineBuilder<number>()
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
    const op = new PipelineBuilder<string>()
      .parallel({
        upper: new PipelineBuilder<string>().step((value) => value.toUpperCase()).build(),
        length: new PipelineBuilder<string>().step(async (value) => value.length).build(),
        includesA: new PipelineBuilder<string>().step((value) => value.includes("a")).build(),
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
    const op = new PipelineBuilder<string>()
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
    const op = new PipelineBuilder<string>()
      .step((value) => `Extract priority: ${value}`)
      .extract(extractor)
      .build();

    await expect(op.run("urgent incident")).resolves.toEqual({ priority: "high" });
  });

  it("rejects run and batch when a step throws", async () => {
    const op = new PipelineBuilder<number>()
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
    const op = new PipelineBuilder<number>().use(createPipelineOp((value) => value + 10)).build();

    await expect(op.run(5)).resolves.toBe(15);
  });

  it("does not expose the old helper-first methods at type level", () => {
    const builder = new PipelineBuilder<number>();
    const op = builder.step((value) => value + 1).build();

    if (unreachable()) {
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
});

function unreachable(): boolean {
  return false;
}

function createPipelineOp<Input, Output>(
  run: (input: Input) => Output | Promise<Output>,
): PipelineOp<Input, Output> {
  return { run };
}
