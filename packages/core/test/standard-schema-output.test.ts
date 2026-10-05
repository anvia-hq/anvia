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

function converterSchema(data: unknown): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "cached-json",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => data,
        output: () => {
          throw new Error("Output conversion must not be used.");
        },
      },
    },
  } as StandardSchemaV1;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
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
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["low", "high"] },
      },
      required: ["title", "priority"],
      additionalProperties: false,
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
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["low", "high"] },
      },
      required: ["title", "priority"],
      additionalProperties: false,
    });
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
      additionalProperties: false,
    });
  });

  it("completes schema positions without rewriting literal values", async () => {
    const model = new QueueModel(['{"title":"Typed"}']);
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
          input: () => ({
            type: "object",
            properties: {
              title: { type: "string" },
              config: { const: { type: "object", detail: "kept" } },
              choices: { enum: [{ type: "object" }] },
              nested: { type: "object" },
              combined: { anyOf: [{ type: "object" }, { type: "null" }] },
              payload: {
                contentEncoding: "base64",
                contentSchema: { type: "object" },
              },
            },
            required: ["title", "config", "choices", "nested", "combined", "payload"],
            dependentSchemas: {
              config: { properties: { detail: { type: "string" } } },
            },
            $defs: { Extra: { type: "object" } },
          }),
        },
      },
    } as unknown as StandardSchemaV1<{ title: string }> & StandardJSONSchemaV1<{ title: string }>;

    await generateCompletion({ model, prompt: "extract", outputSchema: schema });

    // Strict-object refinements are added at schema positions only; literal
    // values under const and enum must stay untouched or const matching and
    // enum membership would silently change.
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        config: { const: { type: "object", detail: "kept" } },
        choices: { enum: [{ type: "object" }] },
        nested: { type: "object", additionalProperties: false },
        combined: {
          anyOf: [{ type: "object", additionalProperties: false }, { type: "null" }],
        },
        payload: {
          contentEncoding: "base64",
          contentSchema: { type: "object", additionalProperties: false },
        },
      },
      required: ["title", "config", "choices", "nested", "combined", "payload"],
      dependentSchemas: {
        config: {
          properties: { detail: { type: "string" } },
        },
      },
      $defs: { Extra: { type: "object", additionalProperties: false } },
      additionalProperties: false,
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
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { count: { type: "string" } },
      required: ["count"],
      additionalProperties: false,
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
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { length: { type: "string" } },
      required: ["length"],
      additionalProperties: false,
    });
  });

  it("sends the input schema to the provider for representable Zod pipes", async () => {
    const model = new QueueModel(['{"count":"42"}']);

    const result = await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: z.object({ count: z.string().pipe(z.coerce.number()) }),
    });

    expectTypeOf(result.output).toEqualTypeOf<{ count: number }>();
    expect(result.output).toEqual({ count: 42 });
    // The output side would describe a number while validation expects the
    // string input, so the provider must receive the input representation,
    // completed with strict-object refinements for provider strict modes.
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { count: { type: "string" } },
      required: ["count"],
      additionalProperties: false,
    });
  });

  it("keeps strict-object refinements for Zod schemas without input differences", async () => {
    const model = new QueueModel(['{"title":"Typed"}']);

    await generateCompletion({
      model,
      prompt: "Extract a ticket.",
      outputSchema: z.object({ title: z.string() }),
    });

    // Pure strictness refinements do not describe different accepted values,
    // so the output representation (and its refinements) is preserved.
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    });
  });

  it("owns cached nested converter data across repeated direct and streamed calls", async () => {
    const data = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { nested: { type: "object", properties: { title: { type: "string" } } } },
    };
    const schema = converterSchema(data);
    const model = new QueueModel(["{}", "{}"]);
    await generateCompletion({ model, prompt: "extract", outputSchema: schema });
    await generateCompletion({ model, prompt: "extract", outputSchema: schema });
    const streamed = new StreamingQueueModel({}, ["{}"]);
    const events = await collect(
      streamCompletion({ model: streamed, prompt: "extract", outputSchema: schema }),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: {} } });
    for (const request of [...model.requests, ...streamed.requests]) {
      expect(request.outputSchema).toEqual({
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: { title: { type: "string" } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      });
    }
    expect(data).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { nested: { type: "object", properties: { title: { type: "string" } } } },
    });
    expect(model.requests[0]?.outputSchema?.properties).not.toBe(data.properties);
  });

  it("converts deeply frozen data and separates aliased schema and literal occurrences", async () => {
    const shared = { type: "object" };
    const data = deepFreeze({
      type: "object",
      properties: { nested: shared },
      const: shared,
      enum: [shared],
      default: shared,
      examples: [shared],
      "x-extension": shared,
    });
    const model = new QueueModel(["{}"]);
    const result = await generateCompletion({
      model,
      prompt: "extract",
      outputSchema: converterSchema(data),
    });
    expect(result.output).toEqual({});
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: { nested: { type: "object", additionalProperties: false } },
      const: { type: "object" },
      enum: [{ type: "object" }],
      default: { type: "object" },
      examples: [{ type: "object" }],
      "x-extension": { type: "object" },
      additionalProperties: false,
    });
    expect(data).toEqual({
      type: "object",
      properties: { nested: { type: "object" } },
      const: { type: "object" },
      enum: [{ type: "object" }],
      default: { type: "object" },
      examples: [{ type: "object" }],
      "x-extension": { type: "object" },
    });
    const providerLiteral = model.requests[0]?.outputSchema?.const as Record<string, unknown>;
    providerLiteral.type = "string";
    expect(shared).toEqual({ type: "object" });
    expect(model.requests[0]?.outputSchema?.default).toEqual({ type: "object" });
  });

  it.each([
    "$defs",
    "definitions",
    "dependencies",
    "dependentSchemas",
    "patternProperties",
    "properties",
  ])("refines object nodes in the %s schema map", async (keyword) => {
    const data = deepFreeze({ [keyword]: { child: { type: "object" } } });
    const model = new QueueModel(["{}"]);
    await generateCompletion({ model, prompt: "extract", outputSchema: converterSchema(data) });
    expect(model.requests[0]?.outputSchema).toEqual({
      [keyword]: { child: { type: "object", additionalProperties: false } },
    });
    expect(data).toEqual({ [keyword]: { child: { type: "object" } } });
  });

  it.each([
    "additionalItems",
    "additionalProperties",
    "contains",
    "contentSchema",
    "else",
    "if",
    "items",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties",
  ])("refines object schemas at %s without altering the original", async (keyword) => {
    const data = deepFreeze({ [keyword]: { type: "object" } });
    const model = new QueueModel(["{}"]);
    await generateCompletion({ model, prompt: "extract", outputSchema: converterSchema(data) });
    expect(model.requests[0]?.outputSchema).toEqual({
      [keyword]: { type: "object", additionalProperties: false },
    });
    expect(data).toEqual({ [keyword]: { type: "object" } });
  });

  it.each(["allOf", "anyOf", "oneOf", "prefixItems", "items"])(
    "refines composition and tuple schemas in %s while preserving boolean schemas",
    async (keyword) => {
      const model = new QueueModel(["{}"]);
      await generateCompletion({
        model,
        prompt: "extract",
        outputSchema: converterSchema(
          deepFreeze({
            [keyword]: [{ type: "object" }, true, false],
          }),
        ),
      });
      expect(model.requests[0]?.outputSchema).toEqual({
        [keyword]: [{ type: "object", additionalProperties: false }, true, false],
      });
    },
  );

  it("preserves explicit permissive and schema-valued additionalProperties", async () => {
    const data = deepFreeze({
      type: "object",
      additionalProperties: true,
      properties: {
        closed: { type: "object", additionalProperties: false },
        mapped: { type: "object", additionalProperties: { type: "object" } },
      },
    });
    const model = new QueueModel(["{}"]);
    await generateCompletion({ model, prompt: "extract", outputSchema: converterSchema(data) });
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      additionalProperties: true,
      properties: {
        closed: { type: "object", additionalProperties: false },
        mapped: {
          type: "object",
          additionalProperties: { type: "object", additionalProperties: false },
        },
      },
    });
    expect(data.properties.mapped.additionalProperties).toEqual({ type: "object" });
  });

  it("copies null-prototype records and dangerous keys without reading discarded metadata", async () => {
    let reads = 0;
    const data = Object.assign(Object.create(null), {
      type: "object",
      "x-data": JSON.parse('{"__proto__":{"type":"object"},"constructor":{"type":"object"}}'),
    });
    Object.defineProperty(data, "$schema", {
      enumerable: true,
      get: () => {
        reads++;
        throw new Error("discarded");
      },
    });
    Object.defineProperty(data, "private", {
      get: () => {
        reads++;
        throw new Error("private");
      },
    });
    const model = new QueueModel(["{}"]);
    const result = await generateCompletion({
      model,
      prompt: "extract",
      outputSchema: converterSchema(data),
    });
    expect(result.output).toEqual({});
    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      "x-data": JSON.parse('{"__proto__":{"type":"object"},"constructor":{"type":"object"}}'),
      additionalProperties: false,
    });
    expect(reads).toBe(0);
    expect(Object.hasOwn(model.requests[0]?.outputSchema?.["x-data"] as object, "__proto__")).toBe(
      true,
    );
  });

  it.each([
    ["boolean root", () => true],
    ["array root", () => []],
    ["null root", () => null],
    ["undefined", () => ({ default: undefined })],
    ["nonfinite number", () => ({ default: Infinity })],
    ["NaN", () => ({ default: NaN })],
    ["bigint", () => ({ default: 1n })],
    ["symbol", () => ({ default: Symbol("invalid") })],
    ["function", () => ({ default: () => 1 })],
    ["custom instance", () => ({ default: new Date() })],
    ["sparse array", () => ({ examples: Array(2) })],
    [
      "cycle",
      () => {
        const data: Record<string, unknown> = {};
        data.self = data;
        return data;
      },
    ],
  ])(
    "rejects %s converter data before direct or streamed provider calls",
    async (_name, makeData) => {
      const schema = converterSchema(makeData());
      const model = new QueueModel(["{}"]);
      await expect(
        generateCompletion({ model, prompt: "extract", outputSchema: schema }),
      ).rejects.toThrow(TypeError);
      const streamed = new StreamingQueueModel({}, ["{}"]);
      await expect(
        (async () =>
          collect(
            streamCompletion({ model: streamed, prompt: "extract", outputSchema: schema }),
          ))(),
      ).rejects.toThrow(TypeError);
      expect(model.requests).toHaveLength(0);
      expect(streamed.requests).toHaveLength(0);
    },
  );

  it("rejects enumerable record and array accessors without evaluating them", async () => {
    let reads = 0;
    const accessor = {
      get type() {
        reads++;
        return "object";
      },
    };
    const array = ["safe"];
    Object.defineProperty(array, "0", {
      get: () => {
        reads++;
        return "unsafe";
      },
    });
    for (const data of [accessor, { examples: array }]) {
      const model = new QueueModel(["{}"]);
      await expect(
        generateCompletion({ model, prompt: "extract", outputSchema: converterSchema(data) }),
      ).rejects.toThrow(TypeError);
      expect(model.requests).toHaveLength(0);
    }
    expect(reads).toBe(0);
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
