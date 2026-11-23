import { describe, expect, it } from "vitest";
import {
  collectModelsFromResponse,
  compactJsonObject,
  defineReasoningEffortControls,
  embedTextBatches,
  indexedEmbeddingDataFromResponse,
  isDecisionDataObject,
  isDecisionProbability,
  isDecisionTokenCount,
  isListedModel,
  isNonblankString,
  isNumberArray,
  isObject,
  isPlainObject,
  isStringArray,
  numberFrom,
  orderedRequestMessages,
  parseToolArguments,
  probabilitiesSumToOne,
  rejectManagedOptionsWithInjectedClient,
  requireApiKey,
  requireModelId,
  schemaName,
  stringFrom,
  toModelListingError,
  toolCallDelta,
  toolChoiceSummary,
  validateOptionalPositiveSafeInteger,
} from "../src/internal/provider";

describe("internal provider helpers", () => {
  it("validates value helpers and clamps negative numbers", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(numberFrom(42)).toBe(42);
    expect(numberFrom(-5)).toBe(0);
    expect(numberFrom(Number.NaN)).toBe(0);
    expect(stringFrom("ok")).toBe("ok");
    expect(stringFrom(1)).toBeUndefined();
    expect(isNonblankString(" a ")).toBe(true);
    expect(isNonblankString("   ")).toBe(false);
    expect(isNumberArray([1, 2])).toBe(true);
    expect(isNumberArray([1, "2"])).toBe(false);
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 2])).toBe(false);
    expect(schemaName({ title: "MySchema" })).toBe("MySchema");
    expect(schemaName({})).toBe("response_schema");
    expect(compactJsonObject({ a: 1, b: undefined, c: "ok", d: Number.NaN })).toEqual({
      a: 1,
      c: "ok",
    });
    expect(toolChoiceSummary("auto")).toBe("auto");
    expect(toolChoiceSummary({ type: "function", name: "lookup" })).toEqual({
      type: "function",
      name: "lookup",
    });
    expect(parseToolArguments("call_1", "")).toEqual({});
    expect(parseToolArguments("call_1", '{"x":1}')).toEqual({ x: 1 });
    expect(() => parseToolArguments("call_1", "{")).toThrow();
    expect(
      toolCallDelta("t1", {
        callId: "",
        name: "",
        argumentsDelta: "{}",
        omitEmptyIdentity: true,
      }),
    ).toEqual({ type: "tool_call_delta", id: "t1", argumentsDelta: "{}" });
  });

  it("orders request messages with instructions, system messages, documents, and turns", () => {
    const messages = orderedRequestMessages(
      {
        instructions: "Primary instruction",
        documents: [{ id: "doc-1", text: "Doc body" }],
        chatHistory: [
          { role: "user", content: "hi" },
          { role: "system", content: "Extra system" },
        ],
        tools: [],
      },
      { includeInstructionsAsSystem: true },
    );

    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user", "user"]);
    expect(messages[0]?.content).toBe("Primary instruction");
    expect(messages[1]?.content).toBe("Extra system");
    expect(messages[3]?.content).toBe("hi");
  });

  it("builds frozen reasoning effort controls", () => {
    const controls = defineReasoningEffortControls(["low", "high"] as const, "high");
    expect(controls.reasoningEffort).toEqual({
      type: "select",
      label: "Reasoning effort",
      description: "Controls how much reasoning the model applies before responding.",
      options: ["low", "high"],
      defaultValue: "high",
    });
    expect(Object.isFrozen(controls)).toBe(true);
  });

  it("validates client credentials, model ids, and model listing helpers", async () => {
    expect(() =>
      rejectManagedOptionsWithInjectedClient("TestClient", { client: {}, apiKey: "k" }, ["apiKey"]),
    ).toThrow("TestClient cannot combine client with apiKey.");
    expect(requireApiKey("Test", "TestClient", "key")).toBe("key");
    expect(() => requireApiKey("Test", "TestClient", 123)).toThrow(
      "Missing Test credentials. Pass apiKey when constructing TestClient.",
    );
    expect(requireModelId("model-1")).toBe("model-1");
    expect(() => requireModelId("" as string)).toThrow(TypeError);
    expect(() => requireModelId(123 as unknown as string)).toThrow(TypeError);
    expect(() => validateOptionalPositiveSafeInteger(0, "dimensions")).toThrow(TypeError);
    expect(isListedModel({ id: "m1" })).toBe(true);
    expect(isListedModel(undefined)).toBe(false);

    async function* streamModels() {
      yield { id: "a" };
      yield { id: "b" };
    }
    await expect(collectModelsFromResponse(streamModels())).resolves.toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    await expect(
      collectModelsFromResponse({ models: [{ id: "g" }] }, { includeModelsKey: true }),
    ).resolves.toEqual([{ id: "g" }]);

    const error = toModelListingError(
      "OpenAI",
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    expect(error.provider).toBe("OpenAI");
    expect(error.statusCode).toBe(403);
  });

  it("batches embeddings and validates indexed embedding responses including null payloads", async () => {
    const seen: string[][] = [];
    const results = await embedTextBatches(["a", "b", "c"], 2, async (batch) => {
      seen.push(batch);
      return batch.map((document) => ({ document, vector: [1] }));
    });
    expect(seen).toEqual([["a", "b"], ["c"]]);
    expect(results).toHaveLength(3);

    expect(indexedEmbeddingDataFromResponse(null, 2)).toEqual([]);
    expect(
      indexedEmbeddingDataFromResponse(
        {
          data: [
            { index: 1, embedding: [2] },
            { index: 0, embedding: [1] },
          ],
        },
        2,
      ),
    ).toEqual([
      { index: 0, embedding: [1] },
      { index: 1, embedding: [2] },
    ]);
    expect(() =>
      indexedEmbeddingDataFromResponse({ data: [{ index: 0, embedding: ["bad"] }] }, 1, "Mistral"),
    ).toThrow("Invalid Mistral embedding response vector at position 0.");
  });

  it("validates decision primitives", () => {
    expect(isDecisionDataObject({ ok: true })).toBe(true);
    expect(isDecisionDataObject([])).toBe(false);
    expect(isDecisionProbability(0.5)).toBe(true);
    expect(isDecisionProbability(1.1)).toBe(false);
    expect(isDecisionTokenCount(0)).toBe(true);
    expect(isDecisionTokenCount(-1)).toBe(false);
    expect(probabilitiesSumToOne([0.25, 0.75])).toBe(true);
    expect(probabilitiesSumToOne([0.2, 0.2])).toBe(false);
  });
});
