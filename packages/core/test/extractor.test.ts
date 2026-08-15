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
  Extractor,
  Message,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities: CompletionModel["capabilities"];
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly responses: Array<CompletionResponse | Error>,
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

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

describe("Extractor", () => {
  it("constructs directly and validates the output schema", () => {
    const model = new QueueModel([]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
    });

    expect(extractor.model).toBe(model);
    expect(extractor.outputSchema).toBeInstanceOf(z.ZodType);
    expect(
      () =>
        new Extractor({
          model,
          outputSchema: {} as z.ZodType<{ value: string }>,
        }),
    ).toThrow("Extractor outputSchema must be a Zod schema");
  });

  it("generates a required submit tool from the output schema", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { name: "Ada", age: 36 })]),
    ]);
    const personSchema = z.object({
      name: z.string().describe("Full name"),
      age: z.number().optional(),
    });

    await new Extractor({ model, outputSchema: personSchema }).extract("Ada is 36");

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

  it("preserves Zod output inference, defaults, refinements, and transforms", async () => {
    const schema = z
      .object({
        label: z.string().transform((value) => value.trim().toUpperCase()),
        count: z.number().default(1),
      })
      .refine((value) => value.label.length > 0);
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { label: " accepted " })]),
    ]);
    const extractor = new Extractor({ model, outputSchema: schema });

    expectTypeOf(extractor).toEqualTypeOf<
      Extractor<{ label: string; count: number }, QueueModel>
    >();
    await expect(extractor.extract("status accepted")).resolves.toEqual({
      label: "ACCEPTED",
      count: 1,
    });
  });

  it("returns submitted data, cumulative usage, and successful messages", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { sentiment: "positive" })], {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      }),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ sentiment: z.enum(["positive", "negative"]) }),
    });

    const result = await extractor.extractResult("great");

    expect(result.data).toEqual({ sentiment: "positive" });
    expect(result.usage.totalTokens).toBe(8);
    expect(result.messages).toEqual([
      Message.user("great"),
      expect.objectContaining({ role: "assistant" }),
    ]);
  });

  it("combines extraction instructions and forwards call options", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { value: "ok" })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
      instructions: "Prefer concise values.",
    });

    await extractor.extract("extract", {
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
    expect(model.requests[0]?.instructions).toEqual(
      expect.stringContaining("purpose is to extract structured data"),
    );
    expect(model.requests[0]?.instructions).toEqual(
      expect.stringContaining("Prefer concise values."),
    );
  });

  it("retries when the model omits the submit call", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("not structured")], {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
      response([AssistantContent.toolCall("submit_1", "submit", { value: 1 })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.number() }),
    });

    const result = await extractor.extractResult("one", retryTwice());

    expect(result.data).toEqual({ value: 1 });
    expect(result.usage.totalTokens).toBe(2);
    expect(model.requests).toHaveLength(2);
  });

  it("does not retry extraction failures unless retries are configured", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("not structured")]),
      response([AssistantContent.toolCall("submit_1", "submit", { value: 1 })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.number() }),
    });

    await expect(extractor.extract("one")).rejects.toBeInstanceOf(ExtractionError);
    expect(model.requests).toHaveLength(1);
  });

  it("retries invalid submitted data and accumulates usage", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { value: "one" })], {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
      response([AssistantContent.toolCall("submit_2", "submit", { value: 1 })], {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      }),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.number() }),
    });

    const result = await extractor.extractResult("one", retryTwice());

    expect(result.data).toEqual({ value: 1 });
    expect(result.usage.totalTokens).toBe(5);
    expect(model.requests).toHaveLength(2);
  });

  it("retries provider failures as complete extraction attempts", async () => {
    const model = new QueueModel([
      new Error("temporary provider failure"),
      response([AssistantContent.toolCall("submit_1", "submit", { value: "ok" })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
    });

    await expect(extractor.extract("extract", retryTwice())).resolves.toEqual({ value: "ok" });
    expect(model.requests).toHaveLength(2);
  });

  it("honors a custom retry decision", async () => {
    const retryContexts: unknown[] = [];
    const model = new QueueModel([
      new Error("do not retry"),
      response([AssistantContent.toolCall("submit_1", "submit", { value: "unused" })]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
    });

    await expect(
      extractor.extract("extract", {
        retries: {
          maxAttempts: 3,
          initialDelayMs: 0,
          maxDelayMs: 0,
          shouldRetry(context) {
            retryContexts.push(context);
            return false;
          },
        },
      }),
    ).rejects.toMatchObject({
      name: "ExtractionError",
      cause: expect.objectContaining({ message: "do not retry" }),
    });
    expect(retryContexts).toHaveLength(1);
    expect(model.requests).toHaveLength(1);
  });

  it("throws ExtractionError with the final failure after exhausting attempts", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("first failure")]),
      response([AssistantContent.text("last failure")]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
    });

    const error = await extractor.extract("extract", retryTwice()).catch((failure) => failure);

    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toMatchObject({
      message: "No data extracted",
      cause: expect.objectContaining({ message: "The model did not call the submit tool" }),
    });
    expect(model.requests).toHaveLength(2);
  });

  it("never retries capability errors", async () => {
    const model = new QueueModel([], false);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.string() }),
    });

    await expect(extractor.extract("extract", retryTwice())).rejects.toBeInstanceOf(
      CompletionCapabilityError,
    );
    expect(model.requests).toHaveLength(0);
  });

  it("uses the last submit call when multiple are present", async () => {
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("submit_1", "submit", { value: 1 }),
        AssistantContent.toolCall("submit_2", "submit", { value: 2 }),
      ]),
    ]);
    const extractor = new Extractor({
      model,
      outputSchema: z.object({ value: z.number() }),
    });

    await expect(extractor.extract("two")).resolves.toEqual({ value: 2 });
  });

  it("does not expose builder, context, history, identity, or inner-agent APIs", () => {
    const model = new QueueModel([]);
    const extractor = new Extractor({ model, outputSchema: z.string() });

    expect("ExtractorBuilder" in publicExtractor).toBe(false);
    expect("build" in extractor).toBe(false);
    expect("getInner" in extractor).toBe(false);
    expect("extractWithUsage" in extractor).toBe(false);
    expect("extractWithHistory" in extractor).toBe(false);
    expect("id" in extractor).toBe(false);
    expect("name" in extractor).toBe(false);
    expect("description" in extractor).toBe(false);

    if (unreachable()) {
      // @ts-expect-error - Extractor accepts one options object.
      new Extractor(model, z.string());
      // @ts-expect-error - retrieval context belongs to Agent.
      new Extractor({ model, outputSchema: z.string(), context: [] });
      // @ts-expect-error - Extractor accepts text only.
      extractor.extract(Message.user("extract"));
      // @ts-expect-error - history is not an extraction option.
      extractor.extract("extract", { history: [] });
      // @ts-expect-error - use extractResult(...).
      extractor.extractWithUsage("extract");
      // @ts-expect-error - Extractor has no internal Agent escape hatch.
      extractor.getInner();
      // @ts-expect-error - configuration belongs in constructor options.
      extractor.instructions("custom");
    }
  });
});

function retryTwice() {
  return {
    retries: {
      maxAttempts: 2,
      initialDelayMs: 0,
      maxDelayMs: 0,
    },
  };
}

function unreachable(): boolean {
  return false;
}

function response(
  choice: CompletionResponse["choice"],
  usage?: Partial<Usage>,
): CompletionResponse {
  return {
    choice,
    usage: {
      ...Usage.empty(),
      ...usage,
    },
    rawResponse: {},
  };
}
