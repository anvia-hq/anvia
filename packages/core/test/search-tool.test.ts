import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "../src/agent";
import {
  Usage,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
} from "../src/completion";
import type { Embedding, EmbeddingModel } from "../src/embeddings";
import { createTool, createToolIndex, isToolIndex, searchTool } from "../src/tool";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No queued response");
    return response;
  }
}

const response = (choice: CompletionResponse["choice"]): CompletionResponse => ({
  choice,
  usage: Usage.empty(),
  rawResponse: {},
});

/** One-hot vectors per keyword, so "deploy" only matches the deployment entry. */
class KeywordEmbeddingModel implements EmbeddingModel {
  readonly provider = "test";
  readonly modelId = "keyword";
  readonly texts: string[] = [];

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    this.texts.push(...texts);
    return texts.map((document) => ({ document, vector: vectorFor(document) }));
  }
}

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    normalized.includes("deploy") ? 1 : 0,
    normalized.includes("refund") ? 1 : 0,
    normalized.includes("oncall") ? 1 : 0,
  ];
}

const runbooks = [
  { id: "deploy", text: "Rolling deployment", detail: "1. build 2. canary 3. promote" },
  { id: "refund", text: "Refund a customer", detail: "1. verify order 2. issue refund" },
  { id: "oncall", text: "On-call escalation", detail: "Page the secondary first" },
];

describe("searchTool", () => {
  it("returns a registrable tool index with the one search tool", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });

    expect(isToolIndex(index)).toBe(true);
    expect(index.tools.map((tool) => tool.name)).toEqual(["search_runbooks"]);
    expect((await index.tools[0]!.definition("")).parameters).toMatchObject({
      required: ["query"],
    });
  });

  it("matches terms and returns the hit detail", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    const [result] = await index.search({ query: "how do I deploy the service" });

    expect(result?.id).toBe("deploy");
    expect(result?.document.toolName).toBe("search_runbooks");
  });

  it("ranks by term overlap and ignores stop words", async () => {
    const index = searchTool({
      name: "search_runbooks",
      entities: [...runbooks, { id: "mixed", text: "Refund after a failed deploy" }],
      topK: 2,
    });
    const results = await index.search({ query: "refund after a deploy" });

    // "after" is a stop word, so both terms count: `mixed` matches two of two, the others one.
    expect(results.map((result) => result.id)).toEqual(["mixed", "deploy"]);
  });

  it("returns nothing when no entry matches", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    expect(await index.search({ query: "how do I configure a vpn" })).toEqual([]);
  });

  it("answers the tool call from the turn's own search", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    await index.search({ query: "refund a customer" });

    const output = await index.tools[0]!.call({ query: "refund a customer" });

    expect(output).toBe("Refund a customer\n1. verify order 2. issue refund");
  });

  it("searches itself when the tool is called without a turn search", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    const output = await index.tools[0]!.call({ query: "oncall escalation" });

    expect(output).toContain("Page the secondary first");
  });

  it("reports a miss in the same shape as a hit", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    expect(await index.tools[0]!.call({ query: "vpn setup" })).toBe("No matching entries.");
  });

  it("matches semantically when given a model", async () => {
    const model = new KeywordEmbeddingModel();
    const index = searchTool({ name: "find_runbook", entities: runbooks, model, topK: 1 });
    await index.search({ query: "deploy the service" });

    expect(model.texts.every((text) => !text.includes('"type"'))).toBe(true);
    expect(await index.tools[0]!.call({ query: "deploy the service" })).toBe(
      "Rolling deployment\n1. build 2. canary 3. promote",
    );
  });

  it("remembers what each query searched, so two runs do not share hits", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    await index.search({ query: "deploy" });
    await index.search({ query: "refund" });

    expect(await index.tools[0]!.call({ query: "deploy" })).toContain("Rolling deployment");
    expect(await index.tools[0]!.call({ query: "refund" })).toContain("Refund a customer");
  });

  it("resolves promised entities once", async () => {
    let loads = 0;
    const index = searchTool({
      name: "search_runbooks",
      entities: Promise.resolve(runbooks).then((list) => {
        loads += 1;
        return list;
      }),
    });
    await index.search({ query: "deploy" });
    await index.search({ query: "refund" });

    expect(loads).toBe(1);
  });

  it("applies a custom formatter", async () => {
    const index = searchTool({
      name: "search_runbooks",
      entities: runbooks,
      format: (hits) => hits.map((hit) => `${hit.id}:${hit.score}`).join(","),
    });
    await index.search({ query: "deploy" });

    expect(await index.tools[0]!.call({ query: "deploy" })).toBe("deploy:1");
  });

  it("validates its options", () => {
    expect(() => searchTool({ name: " ", entities: runbooks })).toThrow("must not be empty");
    expect(() => searchTool({ name: "s", entities: runbooks, topK: 0 })).toThrow(RangeError);
    expect(() => searchTool({ name: "s", entities: runbooks, minScore: 0.5 })).toThrow(
      "minScore requires a model",
    );
  });

  it("rejects duplicate entity ids on first use", async () => {
    const index = searchTool({
      name: "search_runbooks",
      entities: [
        { id: "a", text: "one" },
        { id: "a", text: "two" },
      ],
    });
    await expect(index.search({ query: "one" })).rejects.toThrow('Duplicate search entity id "a"');
  });
});

describe("searchTool in an agent", () => {
  it("is advertised, called, and its result reaches the model", async () => {
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    const model = new QueueModel([
      response([
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "search_runbooks",
          input: { query: "deploy" },
        },
      ]),
      response([{ type: "text", text: "Follow the rolling deployment steps." }]),
    ]);
    const agent = new Agent({ id: "ops", model, tools: [index] });

    const result = await agent.generate({ prompt: "how do I deploy?" });

    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["search_runbooks"]);
    expect(model.requests).toHaveLength(2);
    // A later turn carries the conversation as chatHistory, not messages.
    const history = model.requests[1]?.chatHistory ?? [];
    const toolMessage = history.at(-1);
    expect(toolMessage?.role).toBe("tool");
    expect(JSON.stringify(toolMessage)).toContain("canary");
    expect(result.text).toBe("Follow the rolling deployment steps.");
  });

  it("searches the entity text on the turn after a hit", async () => {
    const base = searchTool({
      name: "search_runbooks",
      entities: [
        { id: "deploy", text: "Rolling deployment", detail: "canary then promote" },
        { id: "refund", text: "Refund a customer", detail: "verify the order first" },
      ],
    });
    const queries: string[] = [];
    const index: typeof base = {
      ...base,
      search: (event) => {
        queries.push(event.query);
        return base.search(event);
      },
    };
    const model = new QueueModel([
      response([
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "search_runbooks",
          input: { query: "refund a customer" },
        },
      ]),
      response([{ type: "text", text: "Verify the order first." }]),
    ]);

    await new Agent({ id: "ops", model, tools: [index] }).generate({
      prompt: "how do I handle a refund?",
    });

    // Turn 1 searches the user's words; turn 2 searches the result the model just received, which
    // is how a discovered entity reaches the Ops turn instead of the original question again.
    expect(queries).toEqual([
      "how do I handle a refund?",
      "Refund a customer\nverify the order first",
    ]);
  });

  it("coexists with an ordinary vector index in the same agent", async () => {
    const ordinary = await createToolIndex({
      model: new KeywordEmbeddingModel(),
      tools: [
        createTool({
          name: "refund_tool",
          description: "Refund an order.",
          inputSchema: z.object({ orderId: z.string() }),
          handler: ({ orderId }) => orderId,
        }),
      ],
      topK: 1,
    });
    const index = searchTool({ name: "search_runbooks", entities: runbooks });
    const model = new QueueModel([response([{ type: "text", text: "done" }])]);
    const agent = new Agent({ id: "ops", model, tools: [ordinary, index] });

    await agent.generate({ prompt: "deploy the service" });

    const offered = model.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(offered).toContain("search_runbooks");
    expect(offered).toContain("refund_tool");
  });
});
