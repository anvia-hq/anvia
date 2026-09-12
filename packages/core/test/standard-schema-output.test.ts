import { describe, expect, expectTypeOf, it } from "vitest";
import * as v from "valibot";
import { z } from "zod";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "../src/schema";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  CompletionStructuredOutputError,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  generateCompletion,
  type StreamingCompletionModel,
  streamCompletion,
} from "./helpers/imports";

const valibotSchema = v.object({
  title: v.string(),
  priority: v.picklist(["low", "high"]),
});

const typedJson = '{"title":"Typed","priority":"high"}';

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "standard-schema";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly outputs: Array<string | CompletionResponse>) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const output = this.outputs.shift();
    if (output === undefined) throw new Error("No queued model output.");
    return typeof output === "string" ? response(output) : output;
  }
}

class StreamingQueueModel extends QueueModel implements StreamingCompletionModel {
  constructor(
    capabilities: Partial<CompletionModelCapabilities>,
    private readonly streamingOutputs: Array<string | readonly CompletionModelStreamEvent[]>,
  ) {
    super([]);
    Object.assign(this.capabilities, { streaming: true, ...capabilities });
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const output = this.streamingOutputs.shift();
    if (output === undefined) throw new Error("No queued streaming model output.");
    if (typeof output === "string") {
      yield { type: "final", response: response(output) };
      return;
    }
    yield* output;
  }
}

function response(text: string): CompletionResponse {
  return {
    choice: [AssistantContent.text(text)],
    usage: {
      inputTokens: 0,
      outputTokens: 1,
      totalTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rawResponse: {},
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("Standard Schema structured output", () => {
  it("accepts Valibot schemas and converts them to a provider JSON schema", async () => {
    const model = new QueueModel([typedJson]);

    const result = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: valibotSchema,
    });

    expectTypeOf(result.output).toEqualTypeOf<{ title: string; priority: "low" | "high" }>();
    expect(result.output).toEqual({ title: "Typed", priority: "high" });
    expect(model.requests).toHaveLength(1);
    const providerSchema = model.requests[0]?.outputSchema;
    expect(providerSchema).toBeDefined();
    expect(providerSchema).not.toHaveProperty("$schema");
    expect(providerSchema).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["low", "high"] },
      },
      required: ["title", "priority"],
    });
  });

  it("supports piped Valibot schemas during conversion and validation", async () => {
    const model = new QueueModel(['{"title":"Typed","priority":"low"}']);

    const result = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: v.object({
        title: v.pipe(v.string(), v.minLength(3)),
        priority: v.picklist(["low", "high"]),
      }),
    });

    expect(result.output).toEqual({ title: "Typed", priority: "low" });
  });

  it("surfaces unsupported Valibot actions as conversion failures before model calls", async () => {
    const model = new QueueModel([typedJson]);

    await expect(
      generateCompletion({
        model,
        prompt: "Extract a ticket.",
        outputSchema: v.object({ title: v.pipe(v.string(), v.trim()) }),
      }),
    ).rejects.toThrow(/cannot be converted to JSON Schema/);
    expect(model.requests).toHaveLength(0);
  });

  it("reports Valibot validation issues as structured output schema failures", async () => {
    const model = new QueueModel(['{"title":42,"priority":"high"}']);

    const error = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: valibotSchema,
    }).catch((value) => value);

    expect(error).toBeInstanceOf(CompletionStructuredOutputError);
    expect(error).toMatchObject({ phase: "schema" });
  });

  it("rejects Valibot schemas when the model does not support output schemas", async () => {
    const model = new QueueModel([]);
    model.capabilities.outputSchema = false;

    await expect(
      generateCompletion({ model, prompt: "Extract a ticket.", outputSchema: valibotSchema }),
    ).rejects.toThrow("test:standard-schema does not support output schemas.");
    expect(model.requests).toHaveLength(0);
  });

  it("streams Valibot structured output and defers the schema conversion to the stream", async () => {
    const model = new StreamingQueueModel({}, [typedJson]);

    const events = await collect(
      streamCompletion({ model, prompt: "extract", outputSchema: valibotSchema }),
    );
    const final = events.at(-1);

    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("Expected a final event.");
    expectTypeOf(final.result.output).toEqualTypeOf<{
      title: string;
      priority: "low" | "high";
    }>();
    expect(final.result).toMatchObject({
      output: { title: "Typed", priority: "high" },
      text: typedJson,
    });
    expect(model.requests[0]?.outputSchema).toBeDefined();
  });

  it("enforces output schema capabilities before streaming with deferred conversions", () => {
    const model = new StreamingQueueModel({ outputSchema: false }, []);

    expect(() =>
      streamCompletion({ model, prompt: "extract", outputSchema: valibotSchema }),
    ).toThrow("test:standard-schema does not support output schemas.");
    expect(model.requests).toHaveLength(0);
  });

  it("rejects schemas from vendors without JSON Schema conversion support", async () => {
    const model = new QueueModel([typedJson]);
    const unsupported: StandardSchemaV1<{ title: string }> = {
      "~standard": {
        version: 1,
        vendor: "acme",
        validate: (value) => ({ value: value as { title: string } }),
      },
    };

    await expect(
      generateCompletion({ model, prompt: "extract", outputSchema: unsupported }),
    ).rejects.toThrow(
      'Structured output schemas from vendor "acme" cannot be converted to a provider JSON schema.',
    );
    expect(model.requests).toHaveLength(0);
  });

  it("uses the Standard JSON Schema input representation when a schema provides it", async () => {
    const model = new QueueModel(['{"title":"Typed"}']);
    const targets: string[] = [];
    const schema = {
      "~standard": {
        version: 1,
        vendor: "acme-json",
        validate: (value: unknown) => ({ value: value as { title: string } }),
        jsonSchema: {
          output: () => {
            throw new Error(
              "Providers receive the validation input, so output conversion must not be used.",
            );
          },
          input: (options: { target: string }) => {
            targets.push(options.target);
            return {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: { title: { type: "string" } },
            };
          },
        },
      },
    } as unknown as StandardSchemaV1<{ title: string }> & StandardJSONSchemaV1<{ title: string }>;

    const result = await generateCompletion({
      model,
      prompt: "extract",
      outputSchema: schema,
    });

    expect(result.output).toEqual({ title: "Typed" });
    expect(targets).toEqual(["draft-2020-12"]);
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  it("sends the input schema to the provider for transformed Valibot schemas", async () => {
    const model = new QueueModel(['{"count":"42"}']);

    const result = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: v.object({
        count: v.pipe(v.string(), v.transform(Number), v.number()),
      }),
    });

    expectTypeOf(result.output).toEqualTypeOf<{ count: number }>();
    expect(result.output).toEqual({ count: 42 });
    // The provider must be asked for the validation input (string), not the
    // transformed output (number), or the response would fail validation.
    expect(model.requests[0]?.outputSchema).toMatchObject({
      type: "object",
      properties: { count: { type: "string" } },
    });
  });

  it("sends the input schema to the provider for transformed Zod schemas", async () => {
    const model = new QueueModel(['{"length":"hello"}']);

    const result = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: z.object({ length: z.string().transform((value) => value.length) }),
    });

    expectTypeOf(result.output).toEqualTypeOf<{ length: number }>();
    expect(result.output).toEqual({ length: 5 });
    expect(model.requests[0]?.outputSchema).toMatchObject({
      type: "object",
      properties: { length: { type: "string" } },
    });
  });

  it("reports asynchronous schema validation as a schema failure", async () => {
    const model = new QueueModel(['{"title":"Typed"}']);
    const asyncSchema = {
      "~standard": {
        version: 1,
        vendor: "acme-async",
        validate: async (value: unknown) => ({ value: value as { title: string } }),
        jsonSchema: {
          output: () => {
            throw new Error(
              "Providers receive the validation input, so output conversion must not be used.",
            );
          },
          input: () => ({ type: "object", properties: { title: { type: "string" } } }),
        },
      },
    } as unknown as StandardSchemaV1<{ title: string }>;

    const error = await generateCompletion({
      model,
      prompt: "extract",
      outputSchema: asyncSchema,
    }).catch((value) => value);

    expect(error).toBeInstanceOf(CompletionStructuredOutputError);
    expect(error).toMatchObject({ phase: "schema" });
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});
