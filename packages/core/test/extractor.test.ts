import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as agentLite from "../src/index";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  ExtractorBuilder,
  Message,
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

describe("Extractor", () => {
  it("uses a fixed internal extractor agent id", () => {
    const extractor = new ExtractorBuilder(new QueueModel([]), z.object({ value: z.string() }))
      .build()
      .getInner();

    expect(extractor.id).toBe("extractor");
  });

  it("generates a submit tool from Zod schema output", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { name: "Ada", age: 36 })]),
    ]);
    const personSchema = z.object({
      name: z.string().describe("Full name"),
      age: z.number().optional(),
    });

    await new ExtractorBuilder(model, personSchema).build().extract("Ada is 36");

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
          additionalProperties: false,
        },
      },
    ]);
    expect(model.requests[0]?.toolChoice).toBe("required");
  });

  it("returns submitted data and usage", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { sentiment: "positive" })], {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      }),
    ]);

    const result = await new ExtractorBuilder(
      model,
      z.object({ sentiment: z.enum(["positive", "negative"]) }),
    )
      .retries(1)
      .build()
      .extractWithUsage("great");

    expect(result.data).toEqual({ sentiment: "positive" });
    expect(result.usage.totalTokens).toBe(8);
    expect(result.messages.some((message) => message.role === "assistant")).toBe(true);
  });

  it("retries when no submit tool call is produced", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("not json")], {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
      response([AssistantContent.toolCall("submit_1", "submit", { value: 1 })]),
    ]);

    const result = await new ExtractorBuilder(model, z.object({ value: z.number() }))
      .retries(1)
      .build()
      .extractWithUsage("one");

    expect(result.data).toEqual({ value: 1 });
    expect(result.usage.totalTokens).toBe(2);
    expect(model.requests).toHaveLength(2);
  });

  it("retries when submitted data fails Zod validation", async () => {
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

    const result = await new ExtractorBuilder(model, z.object({ value: z.number() }))
      .retries(1)
      .build()
      .extractWithUsage("one");

    expect(result.data).toEqual({ value: 1 });
    expect(result.usage.totalTokens).toBe(5);
    expect(model.requests).toHaveLength(2);
  });

  it("uses the last submit call when multiple are present", async () => {
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("submit_1", "submit", { value: 1 }),
        AssistantContent.toolCall("submit_2", "submit", { value: 2 }),
      ]),
    ]);

    await expect(
      new ExtractorBuilder(model, z.object({ value: z.number() })).build().extract("two"),
    ).resolves.toEqual({ value: 2 });
  });

  it("passes history and builder options to the inner agent request", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("submit_1", "submit", { value: "ok" })]),
    ]);

    await new ExtractorBuilder(model, z.object({ value: z.string() }))
      .instructions("Prefer concise values.")
      .context("Static facts", "facts")
      .temperature(0.1)
      .maxTokens(100)
      .additionalParams({ seed: 1 })
      .build()
      .extractWithHistory("extract", [Message.user("previous")]);

    expect(model.requests[0]).toMatchObject({
      documents: [{ id: "facts", text: "Static facts" }],
      temperature: 0.1,
      maxTokens: 100,
      additionalParams: { seed: 1 },
    });
    expect(model.requests[0]?.instructions).toEqual(
      expect.stringContaining("Prefer concise values."),
    );
    expect(model.requests[0]?.chatHistory[0]).toEqual(Message.user("previous"));
  });

  it("does not export the removed custom schema helper", () => {
    expect("schema" in agentLite).toBe(false);
  });
});

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
