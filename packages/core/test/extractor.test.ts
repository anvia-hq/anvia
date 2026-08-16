import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as publicExtractor from "../src/extractor";
import {
  AssistantContent,
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  ExtractionError,
  extract,
  Message,
  Usage,
} from "./helpers/imports";

type RawResponse = { requestId: string };

class QueueModel implements CompletionModel<RawResponse> {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities: CompletionModel["capabilities"];
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly responses: Array<CompletionResponse<RawResponse> | Error>,
    supportsTools = true,
  ) {
    this.capabilities = {
      streaming: false,
      tools: supportsTools,
      toolChoice: supportsTools,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: true,
    };
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse<RawResponse>> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No queued response");
    if (response instanceof Error) throw response;
    return response;
  }
}

describe("extract", () => {
  it("validates its object input", async () => {
    const model = new QueueModel([]);
    await expect(
      extract({
        model,
        text: "value",
        outputSchema: {} as z.ZodType<string>,
      }),
    ).rejects.toThrow("extract outputSchema must be a Zod schema");
    await expect(
      extract({
        model,
        text: 42 as unknown as string,
        outputSchema: z.string(),
      }),
    ).rejects.toThrow("extract text must be a string");
  });

  it("generates a required submit tool from the schema", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { name: "Ada", age: 36 })]),
    ]);
    await extract({
      model,
      text: "Ada is 36",
      outputSchema: z.object({
        name: z.string().describe("Full name"),
        age: z.number().optional(),
      }),
    });

    expect(model.requests[0]?.tools).toEqual([
      {
        name: "submit",
        description: "Submit the structured data extracted from the provided text.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Full name" },
            age: { type: "number" },
          },
          required: ["name"],
        },
      },
    ]);
    expect(model.requests[0]?.toolChoice).toBe("required");
  });

  it("preserves schema inference, defaults, refinements, and transforms", async () => {
    const schema = z
      .object({
        label: z.string().transform((value) => value.trim().toUpperCase()),
        count: z.number().default(1),
      })
      .refine((value) => value.label.length > 0);
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { label: " accepted " })]),
    ]);

    const result = await extract({ model, text: "status accepted", outputSchema: schema });

    expectTypeOf(result.output).toEqualTypeOf<{ label: string; count: number }>();
    expectTypeOf(result.rawResponse).toEqualTypeOf<RawResponse>();
    expect(result.output).toEqual({ label: "ACCEPTED", count: 1 });
  });

  it("returns completion details with parsed output", async () => {
    const content = [AssistantContent.toolCall("submit_1", "submit", { sentiment: "positive" })];
    const model = new QueueModel([
      response(content, { inputTokens: 5, outputTokens: 3, totalTokens: 8 }, "request_8"),
    ]);

    const result = await extract({
      model,
      text: "great",
      outputSchema: z.object({ sentiment: z.enum(["positive", "negative"]) }),
    });

    expect(result.output).toEqual({ sentiment: "positive" });
    expect(result.content).toEqual(content);
    expect(result.usage.totalTokens).toBe(8);
    expect(result.rawResponse).toEqual({ requestId: "request_8" });
  });

  it("combines instructions and forwards model-call options", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { value: "ok" })]),
    ]);

    await extract({
      model,
      text: "extract",
      outputSchema: z.object({ value: z.string() }),
      instructions: "Prefer concise values.",
      temperature: 0.1,
      maxTokens: 100,
      providerOptions: { seed: 1 },
    });

    expect(model.requests[0]).toMatchObject({
      temperature: 0.1,
      maxTokens: 100,
      providerOptions: { seed: 1 },
      chatHistory: [Message.user("extract")],
    });
    expect(model.requests[0]?.instructions).toContain("purpose is to extract structured data");
    expect(model.requests[0]?.instructions).toContain("Prefer concise values.");
  });

  it("retries invalid extraction attempts and accumulates usage", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("not structured")], { totalTokens: 2 }),
      response([AssistantContent.toolCall("submit_2", "submit", { value: "wrong" })], {
        totalTokens: 3,
      }),
      response([AssistantContent.toolCall("submit_3", "submit", { value: 1 })], { totalTokens: 4 }),
    ]);

    const result = await extract({
      model,
      text: "one",
      outputSchema: z.object({ value: z.number() }),
      retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
    });

    expect(result.output).toEqual({ value: 1 });
    expect(result.usage.totalTokens).toBe(9);
    expect(model.requests).toHaveLength(3);
  });

  it("retries provider failures only when configured", async () => {
    const model = new QueueModel([
      new Error("temporary provider failure"),
      response([AssistantContent.toolCall("submit_2", "submit", { value: 2 })]),
    ]);

    const result = await extract({
      model,
      text: "two",
      outputSchema: z.object({ value: z.number() }),
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    expect(result.output).toEqual({ value: 2 });
    expect(model.requests).toHaveLength(2);
  });

  it("does not retry unless configured and reports attempts and consumed usage", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("not structured")], { totalTokens: 2 }),
    ]);

    const error = await extract({
      model,
      text: "one",
      outputSchema: z.object({ value: z.number() }),
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toMatchObject({ attempts: 1, usage: { totalTokens: 2 } });
  });

  it("does not wrap capability or abort errors", async () => {
    const unsupported = new QueueModel([], false);
    await expect(
      extract({ model: unsupported, text: "one", outputSchema: z.string() }),
    ).rejects.toBeInstanceOf(CompletionCapabilityError);

    const controller = new AbortController();
    controller.abort("stop");
    const aborted = new QueueModel([]);
    const error = await extract({
      model: aborted,
      text: "one",
      outputSchema: z.string(),
      retries: { maxAttempts: 3 },
      abortSignal: controller.signal,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(aborted.requests).toHaveLength(0);
  });

  it("exposes only the function API", () => {
    expect(publicExtractor.extract).toBe(extract);
    expect("Extractor" in publicExtractor).toBe(false);
    expect("ExtractorBuilder" in publicExtractor).toBe(false);

    if (unreachable()) {
      // @ts-expect-error - the stateful Extractor class was removed.
      new publicExtractor.Extractor({ model: new QueueModel([]), outputSchema: z.string() });
      // @ts-expect-error - extract accepts one object argument.
      extract(new QueueModel([]), "text", z.string());
      // @ts-expect-error - extraction accepts plain text only.
      extract({ model: new QueueModel([]), text: Message.user("text"), outputSchema: z.string() });
      // @ts-expect-error - history belongs to completion or Agent APIs.
      extract({ model: new QueueModel([]), text: "text", outputSchema: z.string(), history: [] });
    }
  });
});

function response(
  choice: CompletionResponse<RawResponse>["choice"],
  usage?: Partial<Usage>,
  requestId = "request_1",
): CompletionResponse<RawResponse> {
  return {
    choice,
    usage: { ...Usage.empty(), ...usage },
    rawResponse: { requestId },
  };
}

function unreachable(): boolean {
  return false;
}
