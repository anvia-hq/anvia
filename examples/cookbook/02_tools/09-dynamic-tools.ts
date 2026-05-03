import assert from "node:assert/strict";
import { AgentBuilder } from "@anvia/core/agent";
import {
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core/completion";
import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import { createTool, createToolIndex } from "@anvia/core/tool";
import { z } from "zod";

class KeywordEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((text) => ({ document: text, vector: vectorFor(text) }));
  }
}

class InspectingModel implements CompletionModel {
  readonly provider = "cookbook";
  readonly defaultModel = "dynamic-tools";
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
  private calls = 0;

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    this.calls += 1;
    return {
      choice:
        this.calls === 1
          ? [
              AssistantContent.toolCall("call_1", "issue_refund", {
                orderId: "A-100",
              }),
            ]
          : [AssistantContent.text("Refund issued.")],
      usage: Usage.empty(),
      rawResponse: {},
    };
  }
}

const issueRefund = createTool({
  name: "issue_refund",
  description: "Issue a refund for a customer order.",
  input: z.object({ orderId: z.string() }),
  output: z.string(),
  execute: ({ orderId }) => `refunded ${orderId}`,
});

const updateAddress = createTool({
  name: "update_address",
  description: "Update the shipping address for an order.",
  input: z.object({ orderId: z.string(), address: z.string() }),
  output: z.string(),
  execute: ({ orderId }) => `updated address for ${orderId}`,
});

const lookupRunbook = createTool({
  name: "lookup_runbook",
  description: "Look up operational runbooks.",
  input: z.object({ query: z.string() }),
  output: z.string(),
  execute: ({ query }) => `runbook: ${query}`,
});

const embeddings = new KeywordEmbeddingModel();
const toolIndex = await createToolIndex(embeddings, [issueRefund, updateAddress, lookupRunbook]);
const model = new InspectingModel();

const agent = new AgentBuilder("support", model)
  .dynamicTools(toolIndex, {
    topK: 1,
    threshold: 0.9,
  })
  .build();

await agent.prompt("Refund order A-100.").send();

const selected = model.requests[0]?.tools.map((tool) => tool.name) ?? [];
console.log("selected tools:", selected.join(", "));
assert.deepEqual(selected, ["issue_refund"]);

const secondTurnTools = model.requests[1]?.tools.map((tool) => tool.name) ?? [];
console.log("second turn tools:", secondTurnTools.join(", "));

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes("refund")) {
    return [1, 0, 0];
  }
  if (normalized.includes("address")) {
    return [0, 1, 0];
  }
  if (normalized.includes("runbook")) {
    return [0, 0, 1];
  }
  return [0.2, 0.2, 0.2];
}
