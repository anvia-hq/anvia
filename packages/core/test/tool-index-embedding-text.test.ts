import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Embedding, EmbeddingModel } from "../src/embeddings";
import { Agent } from "../src/agent";
import { Usage, type CompletionResponse } from "../src/completion";
import { getAgentToolState } from "../src/agent/tool-state";
import { createTool, createToolIndex, embedTools } from "../src/tool";

class RecordingEmbeddingModel implements EmbeddingModel {
  readonly provider = "test";
  readonly modelId = "recording";
  readonly texts: string[] = [];

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    this.texts.push(...texts);
    return texts.map((document) => ({ document, vector: [1, 0] }));
  }

  /** Every chunk of every indexed tool, one string. */
  get joined(): string {
    return this.texts.join("\n");
  }
}

const refundTool = createTool({
  name: "issue_refund",
  description: "Issue a refund for a customer order.",
  inputSchema: z.object({
    orderId: z.string().describe("Order identifier such as A-100"),
    reason: z.enum(["damaged", "late"]).describe("Why the refund is issued"),
  }),
  handler: ({ orderId }) => orderId,
});

describe("tool index embedding text", () => {
  it("embeds the full definition by default", async () => {
    const model = new RecordingEmbeddingModel();
    await createToolIndex({ model, tools: [refundTool], topK: 1 });

    expect(model.joined).toContain('"type":"object"');
    expect(model.joined).toContain('"additionalProperties"');
    expect(model.joined).toContain("orderId");
  });

  it("drops schema scaffolding but keeps property names and describe text", async () => {
    const model = new RecordingEmbeddingModel();
    await createToolIndex({ model, tools: [refundTool], topK: 1, embeddingText: "compact" });

    const text = model.joined;
    expect(text).not.toContain('"type"');
    expect(text).not.toContain("additionalProperties");
    expect(text).toContain("Order identifier such as A-100");
    expect(text).toContain("Why the refund is issued");
    expect(text).toContain("orderId");
    expect(text).toContain("reason");
  });

  it("never embeds nested field descriptions from an output schema", async () => {
    const reportingTool = createTool({
      name: "build_report",
      description: "Build a quarterly report.",
      inputSchema: z.object({ quarter: z.string().describe("Quarter such as 2026-Q1") }),
      outputSchema: z.object({ revenueCents: z.number(), headcount: z.number() }),
      handler: () => ({ revenueCents: 1, headcount: 2 }),
    });
    const model = new RecordingEmbeddingModel();
    await createToolIndex({ model, tools: [reportingTool], topK: 1, embeddingText: "compact" });

    const text = model.joined;
    expect(text).toContain("Quarter such as 2026-Q1");
    expect(text).not.toContain("revenueCents");
    expect(text).not.toContain("headcount");
  });

  it("falls back to name and description for a tool without parameters", async () => {
    const model = new RecordingEmbeddingModel();
    const emptyTool = createTool({
      name: "ping",
      description: "Check that the service is reachable.",
      inputSchema: z.object({}),
      handler: () => "pong",
    });
    await createToolIndex({ model, tools: [emptyTool], topK: 1, embeddingText: "compact" });

    expect(model.texts).toEqual(["ping", "Check that the service is reachable."]);
  });

  it("keeps the model and embedded text on the registered snapshot", async () => {
    const model = new RecordingEmbeddingModel();
    const index = await createToolIndex({ model, tools: [refundTool], topK: 1 });
    const agent = new Agent({
      id: "agent",
      tools: [index],
      model: {
        provider: "test",
        modelId: "test",
        capabilities: {
          streaming: false,
          tools: true,
          toolChoice: true,
          imageInput: false,
          documentInput: false,
          outputSchema: false,
          reasoning: false,
        },
        completion: async (): Promise<CompletionResponse> => ({
          choice: [],
          usage: Usage.empty(),
          rawResponse: {},
        }),
      },
    });

    const registered = getAgentToolState(agent).toolIndexes[0]!;
    expect(registered.embeddingModel).toBe(model);
    expect(registered.embeddedDocuments?.map((document) => document.id)).toEqual(["issue_refund"]);
    expect(registered.embeddedDocuments?.[0]?.text).toContain("orderId");
    expect(Object.isFrozen(registered.embeddedDocuments)).toBe(true);
    expect(Object.isFrozen(registered.embeddedDocuments?.[0])).toBe(true);
  });

  it("lets explicit content win over the embedding text mode", async () => {
    const model = new RecordingEmbeddingModel();
    await embedTools({
      model,
      tools: [refundTool],
      embeddingText: "compact",
      content: () => "custom retrieval text",
    });

    expect(model.joined).toBe("custom retrieval text");
  });
});
